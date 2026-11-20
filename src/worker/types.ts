export type Bindings = {
  DATABASE_URL: string;
  TOKEN_ENCRYPTION_KEY: string;
};
export type Variables = { adminId: string };
export type AppEnv = { Bindings: Bindings; Variables: Variables };
