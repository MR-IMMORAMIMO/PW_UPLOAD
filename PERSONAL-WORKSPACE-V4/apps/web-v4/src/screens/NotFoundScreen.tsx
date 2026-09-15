/**
 * V4 not-found / route-failure foundation.
 *
 * Renders a controlled state instead of a blank white screen when a route
 * does not match. This is a foundation primitive, not a product page.
 */
import { Link } from 'react-router-dom';
import { ROUTE_FOUNDATION } from '../router/routes';

export function NotFoundScreen() {
  return (
    <main className="v4-not-found" data-testid="v4-not-found">
      <h1 className="v4-not-found__title">Page not found</h1>
      <p className="v4-not-found__body">
        The requested route does not exist in the V4 renderer foundation.
      </p>
      <Link className="v4-not-found__link" to={ROUTE_FOUNDATION}>
        Return to the foundation
      </Link>
    </main>
  );
}
