import { Journal } from '@/components/Journal';

/* The journal is the whole app: it reads from this device first and the account
   second, so it has to run in the browser. The server's job is the API routes. */
export default function Page() {
  return <Journal />;
}
