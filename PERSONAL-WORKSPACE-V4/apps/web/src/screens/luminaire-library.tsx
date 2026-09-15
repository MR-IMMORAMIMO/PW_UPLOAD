import { StructuralPlaceholder } from '../components/structural-placeholder';

/**
 * Global RESOURCES destination. The Luminaire Library catalogue composition
 * is not yet implemented; the approved navigation destination is established
 * here with a restrained structural placeholder.
 */
export function LuminaireLibraryScreen() {
  return (
    <StructuralPlaceholder
      title="Luminaire Library"
      detail="Global catalogue of luminaire records used across projects."
    />
  );
}
