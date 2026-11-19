import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div>
        <p className="text-sm font-medium text-primary">404</p>
        <h1 className="mt-2 text-2xl font-semibold text-fg">This page does not exist</h1>
        <Link to="/" className="mt-6 inline-block text-sm font-medium text-primary hover:underline">
          Back to Talkio
        </Link>
      </div>
    </div>
  );
}
