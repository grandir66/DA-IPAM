import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "./auth.config";

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        if (!credentials?.username || !credentials?.password) {
          return null;
        }

        const username = credentials.username as string;
        const password = credentials.password as string;

        // Rate limiting: max 5 tentativi falliti per username ogni 15 minuti
        const { checkRateLimit, recordFailedAttempt } = await import("./rate-limit");
        const rateLimitKey = `login:${username}`;
        if (!checkRateLimit(rateLimitKey, 5, 15 * 60 * 1000)) {
          console.warn(`[Auth] Rate limit raggiunto per utente: ${username}`);
          return null;
        }

        const { getUserByUsername, updateUserLastLogin } = await import("./db");
        const bcrypt = await import("bcrypt");

        const user = getUserByUsername(username);
        if (!user) {
          recordFailedAttempt(rateLimitKey);
          return null;
        }

        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) {
          recordFailedAttempt(rateLimitKey);
          return null;
        }

        updateUserLastLogin(user.id);

        return {
          id: String(user.id),
          name: user.username,
          email: `${user.username}@da-invent.local`,
          role: user.role,
        };
      },
    }),
  ],
});
