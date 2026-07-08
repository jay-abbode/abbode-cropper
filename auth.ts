import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

export const authDisabled =
  process.env.AUTH_DISABLED === 'true' || !process.env.AUTH_GOOGLE_ID;

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  callbacks: {
    signIn({ profile }) {
      return (profile?.email ?? '').endsWith('@shopabbode.com');
    },
    authorized({ auth }) {
      return !!auth?.user;
    },
  },
});
