import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/environment';
import { V4TextEditor } from '../../components/common/V4TextEditor';
import { V4Button } from '../../components/common/V4Button';
import { SctAdd } from '../../components/common/SctIcons';

export function AddMeetingNote({ projectId, meetingId }: { projectId: string; meetingId: string }) {
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const actor = useQuery({ queryKey: ['v4', 'me'], queryFn: () => api.me() });
  return (
    <>
      <V4Button variant="primary" disabled={!actor.data?.displayName} onClick={() => setOpen(true)}>
        <SctAdd />
        Add Note
      </V4Button>
      {actor.isError && (
        <p role="alert">
          Your profile could not be loaded.{' '}
          <button onClick={() => void actor.refetch()}>Retry</button>
        </p>
      )}
      {open && (
        <V4TextEditor
          title="Add Meeting Note"
          value=""
          onClose={() => setOpen(false)}
          onSave={async (content) => {
            if (!content.trim()) throw new Error('Enter a note before saving.');
            if (!actor.data?.displayName) throw new Error('Your profile is not available.');
            await api.createMeetingNote(projectId, meetingId, {
              content: content.trim(),
              authorName: actor.data.displayName,
            });
            await Promise.all([
              client.invalidateQueries({
                queryKey: ['v4', 'meetings', 'notes', projectId, meetingId],
              }),
              client.invalidateQueries({
                queryKey: ['v4', 'meetings', 'detail', projectId, meetingId],
              }),
              client.invalidateQueries({ queryKey: ['v4', 'meetings', 'list', projectId] }),
            ]);
          }}
        />
      )}
    </>
  );
}
