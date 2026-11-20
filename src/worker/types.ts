export type Bindings = {
  DATABASE_URL: string;
  TOKEN_ENCRYPTION_KEY: string;
  ADMIN_BOOTSTRAP_PASSWORD?: string;
};
export type Variables = { adminId: string };
export type AppEnv = { Bindings: Bindings; Variables: Variables };
