import { useSearchParams } from 'react-router-dom';
import { SettingsWorkspace } from './SettingsWorkspace';
export function SettingsPage() {
  const [query] = useSearchParams();
  return (
    <SettingsWorkspace
      key={query.get('section') === 'integrations' ? 'integrations' : 'final'}
      finalView={query.get('section') !== 'integrations'}
    />
  );
}
