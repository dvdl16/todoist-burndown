export interface Env {
	TODOIST_API_KEY: string;
	TELEGRAM_BOT_TOKEN: string;
}

async function fetchAllPages(baseUrl: string, config: RequestInit): Promise<any[]> {
	let results: any[] = [];
	let cursor: string | null = null;

	do {
		const url = new URL(baseUrl);
		if (cursor) url.searchParams.set('cursor', cursor);
		const response = await fetch(url.toString(), config);
		if (!response.ok) throw new Error(`Failed to fetch ${url.toString()}: ${response.status}`);
		const data: any = await response.json();
		results = results.concat(data.results || []);
		cursor = data.next_cursor || null;
	} while (cursor);

	return results;
}

export default {
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
		const config = {
			method: 'GET',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${env.TODOIST_API_KEY}`,
			}
		};
		let wasSuccessful = 'fail';

		try {
			// Get active tasks from Todoist
			const tasks = await fetchAllPages('https://api.todoist.com/api/v1/tasks', config);

			// Filter tasks based on recurrence
			const filteredTasks = tasks.filter((task: any) => {
				const isNonRecurring = !(task.due && task.due.is_recurring);
				return isNonRecurring;
			});

			// Get current date and one week ago date in UTC
			const currentDate = new Date();
			const oneWeekAgo = new Date();
			oneWeekAgo.setDate(currentDate.getDate() - 7);

			let dailyTaskCount: {[key: string]: number} = {};
			let dailyCompletedCount: {[key: string]: number} = {};

			// Initialize counts for each day in the last week to 0
			for (let d = new Date(oneWeekAgo); d <= currentDate; d.setDate(d.getDate() + 1)) {
				const dateString = d.toISOString().split('T')[0];
				dailyTaskCount[dateString] = 0;
				dailyCompletedCount[dateString] = 0;
			}

			// Group tasks created in past week per day
			filteredTasks.forEach((task: any) => {
				const taskDate = new Date(task.created_at);
				if (taskDate >= oneWeekAgo) {
					const dateString = taskDate.toISOString().split('T')[0];
					if (!dailyTaskCount[dateString]) {
						dailyTaskCount[dateString] = 0;
					}
					dailyTaskCount[dateString]++;
				}
			});

			// Get list of completed tasks since one week ago.
			// The by_completion_date endpoint requires both `since` and `until`
			// (max 3-month window between them).
			const sinceParam = oneWeekAgo.toISOString();
			const untilParam = currentDate.toISOString();
			const completedItems = await fetchAllPages(
				`https://api.todoist.com/api/v1/tasks/completed/by_completion_date?since=${sinceParam}&until=${untilParam}&limit=200`,
				config
			);

			// Filter tasks based on recurrence
			const filteredItems = completedItems.filter((task: any) => {
				const isNonRecurring = !(task.due && task.due.is_recurring);
				return isNonRecurring;
			});

			// Group completed tasks per day
			filteredItems.forEach((item: any) => {
				const itemDate = new Date(item.completed_at);
				const dateString = itemDate.toISOString().split('T')[0];
				if (!dailyCompletedCount[dateString]) {
					dailyCompletedCount[dateString] = 0;
				}
				dailyCompletedCount[dateString]++;
			});

			// Split up labels and data of Active Tasks
			const dailyTaskStats = {
				labels: Object.keys(dailyTaskCount),
				data: Object.values(dailyTaskCount)
					.map((_, idx, arr) => arr.slice(0, idx + 1).reduce((a, b) => a + b, 0))
			};

			// Split up labels and data of Completed Tasks
			const dailyCompletedStats = {
				labels: Object.keys(dailyCompletedCount),
				data: Object.values(dailyCompletedCount)
					.map((_, idx, arr) => arr.slice(0, idx + 1).reduce((a, b) => a + b, 0))
			};

			// Build Chart configuration
			const chartConfig = {
				type: 'line',
				data: {
					labels: dailyTaskStats.labels,
					datasets: [
						{
							label: 'Tasks Completed',
							fill: false,
							backgroundColor: '#078a2a',
							borderColor: '#078a2a',
							data: dailyCompletedStats.data,
						},
						{
							label: 'Tasks Created',
							backgroundColor: '#ffc4c5',
							borderColor: '#d95254',
							data: dailyTaskStats.data,
							fill: true,
						},
					],
				},
				options: {
					title: {
						display: true,
						text: 'Tasks Created vs Completed',
					},
				},
			};

			const baseURL = "https://quickchart.io/chart?c=";
			const chartString = encodeURIComponent(JSON.stringify(chartConfig));
			const chartURL = baseURL + chartString;

			const telegramConfig = {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					chat_id: "-555189625",
					text: `Your weekly "Tasks Created vs Completed" report is available: ${chartURL}`
				})
			};

			const telegramResponse = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, telegramConfig);
			if (!telegramResponse.ok) {
				throw new Error('Failed to send message to Telegram');
			}
			wasSuccessful = 'success';
		} catch (error) {
			console.error('Error:', error);
		}

		console.log(`trigger fired at ${event.cron}: ${wasSuccessful}`);
	},
};
