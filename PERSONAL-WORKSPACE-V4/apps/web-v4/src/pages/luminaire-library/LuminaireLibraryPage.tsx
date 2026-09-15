import FinalLibraryView from '../../components/final-ui/FinalLibraryView';
import { LibraryWorkspaceController } from './LibraryWorkspaceController';

export function LuminaireLibraryPage() {
  return (
    <LibraryWorkspaceController renderFinal={(binding) => <FinalLibraryView binding={binding} />} />
  );
}
