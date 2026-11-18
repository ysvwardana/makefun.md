import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './server/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: './data/cosmiclabs.db',
  },
});
