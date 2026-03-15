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
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          return null;
        }

        const username = credentials.username as string;
        const password = credentials.password as string;

        const { getUserByUsername, updateUserLastLogin } = await import("./db");
        const bcrypt = await import("bcrypt");

        const user = getUserByUsername(username);
        if (!user) return null;

        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) return null;

        updateUserLastLogin(user.id);

        return {
          id: String(user.id),
          name: user.username,
          email: `${user.username}@da-ipam.local`,
          role: user.role,
        };
      },
    }),
  ],
});
