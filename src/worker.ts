/**
 * Welcome to Cloudflare Workers!
 *
 * This is a template for a Scheduled Worker: a Worker that can run on a
 * configurable interval:
 * https://developers.cloudflare.com/workers/platform/triggers/cron-triggers/
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export interface Env {
	// Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
	// MY_KV_NAMESPACE: KVNamespace;
	//
	// Example binding to Durable Object. Learn more at https://developers.cloudflare.com/workers/runtime-apis/durable-objects/
	// MY_DURABLE_OBJECT: DurableObjectNamespace;
	//
	// Example binding to R2. Learn more at https://developers.cloudflare.com/workers/runtime-apis/r2/
	// MY_BUCKET: R2Bucket;
	//
	// Example binding to a Service. Learn more at https://developers.cloudflare.com/workers/runtime-apis/service-bindings/
	// MY_SERVICE: Fetcher;
	//
	// Example binding to a Queue. Learn more at https://developers.cloudflare.com/queues/javascript-apis/
	// MY_QUEUE: Queue;
	//
	// Example binding to a D1 Database. Learn more at https://developers.cloudflare.com/workers/platform/bindings/#d1-database-bindings
	// DB: D1Database
}

export default {
	// The scheduled handler is invoked at the interval set in our wrangler.toml's
	// [[triggers]] configuration.
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
		// A Cron Trigger can make requests to other endpoints on the Internet,
		// publish to a Queue, query a D1 Database, and much more.
		const config = {
			method: 'GET',
			headers: {
			  'Content-Type': 'application/json',
			  'Authorization': `Bearer ${env.TODOIST_API_KEY}`,
			}
		};
		let wasSuccessful = 'fail';

		// Get active tasks from Todoist
		const todoistResponse = await fetch('https://api.todoist.com/rest/v2/tasks', config);

		if (todoistResponse.ok) {
			const tasks: [] = await todoistResponse.json();

			// Get current date and two weeks ago date in UTC
			const currentDate = new Date();
			const twoWeeksAgo = new Date();
			twoWeeksAgo.setDate(currentDate.getDate() - 14);
		
			// Filter out tasks created before 2 weeks ago
			const olderTasks = tasks.filter((task: any) => {
				const taskDate = new Date(task.created_at);
				return taskDate < twoWeeksAgo;
			});
			const olderTaskCount = olderTasks.length;

			let dailyTaskCount: {[key: string]: number} = {};
			let dailyCompletedCount: {[key: string]: number} = {};
		
			// Initialize counts for each day in the last two weeks to 0
			for (let d = new Date(twoWeeksAgo); d <= currentDate; d.setDate(d.getDate() + 1)) {
				const dateString = d.toISOString().split('T')[0];
				dailyTaskCount[dateString] = 0;
				dailyCompletedCount[dateString] = 0;
			}
		
			// Group tasks created in past two weeks per day
			tasks.forEach((task: any) => {
				const taskDate = new Date(task.created_at);
				if (taskDate >= twoWeeksAgo) {
					const dateString = taskDate.toISOString().split('T')[0];
					if (!dailyTaskCount[dateString]) {
						dailyTaskCount[dateString] = 0;
					}
					dailyTaskCount[dateString]++;
				}
			});

			// Get list of completed tasks since two weeks ago
			const sinceParam = twoWeeksAgo.toISOString();
			let completedResponse = await fetch(`https://api.todoist.com/sync/v9/completed/get_all?since=${sinceParam}&limit=200`, config);
		
			if (completedResponse.ok) {
				const completedItems: any = await completedResponse.json();

				// Group completed tasks per day
				completedItems.items.forEach((item: any) => {
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
						.map((_, idx, arr) => arr.slice(0, idx + 1).reduce((a, b) => a + b, 0))};

				// Split up labels and data of Completed Tasks
				const dailyCompletedStats = {
					labels: Object.keys(dailyCompletedCount),
					data: Object.values(dailyCompletedCount)
						.map((_, idx, arr) => arr.slice(0, idx + 1).reduce((a, b) => a + b, 0))};

				// Build Chart configuration
				let chartConfig = {
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
				}

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
				else {
					wasSuccessful = telegramResponse.ok ? 'success' : 'fail';
				}
			}
		}

		// You could store this result in KV, write to a D1 Database, or publish to a Queue.
		// In this template, we'll just log the result:
		console.log(`trigger fired at ${event.cron}: ${wasSuccessful}`);
	},
};
