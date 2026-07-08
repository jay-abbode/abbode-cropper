import { NextResponse } from 'next/server';
import { auth, authDisabled } from '@/auth';

export default authDisabled ? () => NextResponse.next() : auth;

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico|fonts).*)'],
};
