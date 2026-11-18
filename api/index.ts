import { createRuntime } from '../server/runtime.js';

const { app } = await createRuntime(process.env, { vercel: true });

export default app;
