import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, Clock3, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { AppNotification } from '@scli/domain';
import { api } from '../api';
import { useAppContext } from '../app-context';
import { useToast } from '../components/toast';
import { EmptyState, ErrorState, LoadingState, PageHeader, formatDate } from '../components/ui';

type NotificationFilter = 'all' | 'unread' | 'action';

const actionTypes = new Set<AppNotification['type']>([
  'Assignment',
  'Deadline',
  'Revision',
  'TimesheetSubmitted',
  'TimesheetRejected',
]);

function urgency(notification: AppNotification): 'attention' | 'update' {
  return actionTypes.has(notification.type) ? 'attention' : 'update';
}

export function NotificationsScreen() {
  const { currentUser } = useAppContext();
  const [filter, setFilter] = useState<NotificationFilter>('unread');
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const notificationsQuery = useQuery({
    queryKey: ['notifications', currentUser.id],
    queryFn: api.notifications,
    refetchInterval: 30_000,
  });
  const notifications = notificationsQuery.data ?? [];
  const visible = useMemo(
    () =>
      notifications.filter((item) => {
        if (filter === 'unread') return !item.isRead;
        if (filter === 'action') return actionTypes.has(item.type);
        return true;
      }),
    [filter, notifications],
  );

  const markOne = useMutation({
    mutationFn: api.markNotificationRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const markAll = useMutation({
    mutationFn: api.markAllNotificationsRead,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['notifications'] });
      showToast(
        result.updated
          ? `${result.updated} notifications marked as read.`
          : 'No unread notifications.',
      );
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });

  const openNotification = (item: AppNotification) => {
    if (!item.isRead) markOne.mutate(item.id);
    if (item.projectId) navigate(`/projects/${item.projectId}`);
  };

  return (
    <>
      <PageHeader
        eyebrow="Focused updates"
        title="Notifications"
        description="Action items are separated from routine updates so the important work stays visible."
        actions={
          <button
            className="button secondary"
            type="button"
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending}
          >
            <CheckCheck size={17} /> Mark all read
          </button>
        }
      />
      <div className="notification-page-toolbar">
        <div className="quick-filter-chips" role="group" aria-label="Filter notifications">
          <button
            type="button"
            className={filter === 'unread' ? 'active' : ''}
            onClick={() => setFilter('unread')}
          >
            Unread <span>{notifications.filter((item) => !item.isRead).length}</span>
          </button>
          <button
            type="button"
            className={filter === 'action' ? 'active' : ''}
            onClick={() => setFilter('action')}
          >
            Needs action{' '}
            <span>{notifications.filter((item) => actionTypes.has(item.type)).length}</span>
          </button>
          <button
            type="button"
            className={filter === 'all' ? 'active' : ''}
            onClick={() => setFilter('all')}
          >
            All
          </button>
        </div>
      </div>
      {notificationsQuery.isLoading ? <LoadingState label="Loading notifications…" /> : null}
      {notificationsQuery.error ? (
        <ErrorState
          message={(notificationsQuery.error as Error).message}
          onRetry={() => notificationsQuery.refetch()}
        />
      ) : null}
      {!notificationsQuery.isLoading && !visible.length ? (
        <EmptyState
          title="You’re all caught up"
          description="New assignments, requests and approvals will appear here."
        />
      ) : null}
      <div className="notification-page-list">
        {visible.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`notification-page-item ${urgency(item)}${item.isRead ? '' : ' unread'}`}
            onClick={() => openNotification(item)}
          >
            <span className="notification-page-icon">
              {urgency(item) === 'attention' ? <Clock3 size={19} /> : <Bell size={19} />}
            </span>
            <span className="notification-page-copy">
              <span>
                <strong>{item.title}</strong>
                <em>{urgency(item) === 'attention' ? 'Needs action' : 'Update'}</em>
              </span>
              <span>{item.message}</span>
              <small>{formatDate(item.createdAt, { hour: '2-digit', minute: '2-digit' })}</small>
            </span>
            {item.projectId ? <ExternalLink size={17} /> : null}
          </button>
        ))}
      </div>
    </>
  );
}
