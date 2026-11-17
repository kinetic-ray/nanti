// An .env used for local API cookies can otherwise switch Vite to development React.
process.env.NODE_ENV = 'production';
const { build } = await import('vite');
await build();
