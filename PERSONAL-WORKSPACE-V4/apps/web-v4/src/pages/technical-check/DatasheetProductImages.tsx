import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { datasheetImagesSchema } from '@scli/contracts';
import { api } from '../../api/environment';
import { V4FloatingWorkspace } from '../../components/common/V4FloatingWorkspace';
import { V4Button } from '../../components/common/V4Button';

export function DatasheetProductImages({
  projectId,
  luminaireId,
  onClose,
}: {
  projectId: string;
  luminaireId: string;
  onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState('');
  const client = useQueryClient();
  const images = useQuery({
    queryKey: ['v4', 'datasheet-product-images', projectId, luminaireId, page],
    queryFn: async () =>
      datasheetImagesSchema.parse(await api.datasheetImages(projectId, luminaireId, page)),
    retry: false,
  });
  const save = useMutation({
    mutationFn: async () => {
      if (!images.data || !selected) throw new Error('Choose an image from the current page.');
      await api.useDatasheetImage(projectId, luminaireId, {
        pageNumber: page,
        sourceAssetVersionId: images.data.sourceAssetVersionId,
        currentImageVersionId: images.data.currentImageVersionId,
        imageHash: selected,
      });
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['v4'] });
      onClose();
    },
  });
  const choices = images.data?.images ?? [];
  return (
    <V4FloatingWorkspace
      open
      title="Product image from Datasheet"
      description="Choose the image that belongs to this exact model. Logos, diagrams and other models may also appear. Saving creates a new image version and preserves history."
      onRequestClose={() => {
        if (!save.isPending) onClose();
      }}
      panelClassName="v4-datasheet-product-images"
      footer={
        <>
          <V4Button onClick={onClose} disabled={save.isPending}>
            Cancel
          </V4Button>
          <V4Button
            variant="primary"
            disabled={!selected || images.isFetching || save.isPending}
            onClick={() => save.mutate()}
          >
            Use selected image
          </V4Button>
        </>
      }
    >
      <label>
        PDF page{' '}
        <input
          aria-label="PDF page"
          type="number"
          min="1"
          max="200"
          value={page}
          disabled={save.isPending}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (Number.isInteger(value) && value >= 1 && value <= 200) {
              setPage(value);
              setSelected('');
              setIndex(0);
            }
          }}
        />
      </label>
      {images.isPending ? <p role="status">Reading images from the attached Datasheet…</p> : null}
      {images.error || save.error ? (
        <p role="alert">{(images.error || save.error)?.message}</p>
      ) : null}
      {images.data && !choices.length ? (
        <p>
          No embedded product images on this page. Try another page. Scanned pages and vector
          drawings may need manual image selection.
        </p>
      ) : null}
      <div className="v4-datasheet-image-grid">
        {choices.slice(index * 4, index * 4 + 4).map((image) => (
          <button
            key={image.hash}
            type="button"
            aria-pressed={selected === image.hash}
            aria-label={`Select image ${choices.indexOf(image) + 1} from page ${page}`}
            onClick={() => setSelected(image.hash)}
            disabled={save.isPending}
          >
            <img
              src={`data:image/png;base64,${image.pngBase64}`}
              alt={`Datasheet candidate ${choices.indexOf(image) + 1}`}
            />
            <span>
              {image.width} × {image.height} · Page {image.pageNumber}
            </span>
          </button>
        ))}
      </div>
      {choices.length > 4 ? (
        <nav aria-label="Image choices">
          <V4Button disabled={!index} onClick={() => setIndex(index - 1)}>
            Previous
          </V4Button>
          <span>
            {index + 1} / {Math.ceil(choices.length / 4)}
          </span>
          <V4Button
            disabled={(index + 1) * 4 >= choices.length}
            onClick={() => setIndex(index + 1)}
          >
            Next
          </V4Button>
        </nav>
      ) : null}
    </V4FloatingWorkspace>
  );
}
