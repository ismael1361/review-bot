import { useEffect, useRef } from 'react';

const EVENT_TYPES = [
  'queue.updated',
  'job.created',
  'job.started',
  'job.progress',
  'job.finished',
  'job.retry_scheduled',
  'job.failed',
  'job.partial',
  'poll.updated',
  'poll.skipped',
  'poller.paused',
  'review.published',
];

export function useEvents(onEvent: (type: string) => void): void {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (typeof EventSource === 'undefined') {
      return;
    }

    const source = new EventSource('/api/events');
    const handler = (event: MessageEvent) => {
      onEventRef.current(event.type);
    };

    for (const type of EVENT_TYPES) {
      source.addEventListener(type, handler);
    }
    source.onopen = () => onEventRef.current('open');

    return () => {
      source.close();
    };
  }, []);
}
