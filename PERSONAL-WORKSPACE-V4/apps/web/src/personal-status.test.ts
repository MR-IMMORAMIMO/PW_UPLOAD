import { describe, expect, it } from 'vitest';
import { personalStatusDescription, personalStatusLabel } from './personal-status';

describe('personalStatusLabel', () => {
  it('presents Planning as Not Started Yet in the personal workspace', () => {
    expect(personalStatusLabel('Planning')).toBe('Not Started Yet');
  });

  it('keeps the domain labels for every other project status', () => {
    expect(personalStatusLabel('InProgress')).toBe('In Progress');
    expect(personalStatusLabel('WaitingForSales')).toBe('Waiting for Sales');
  });

  it('presents ClientReview as Client Review', () => {
    expect(personalStatusLabel('ClientReview')).toBe('Client Review');
  });
});

describe('personalStatusDescription', () => {
  it('provides concise context for canonical Personal statuses', () => {
    expect(personalStatusDescription('Planning')).toBe('Work has not started yet.');
    expect(personalStatusDescription('InProgress')).toBe('Design work is currently active.');
    expect(personalStatusDescription('ClientReview')).toBe(
      'Waiting for client feedback or approval.',
    );
    expect(personalStatusDescription('RevisionRequired')).toBe(
      'Client feedback requires design updates.',
    );
    expect(personalStatusDescription('OnHold')).toBe('Project workflow is temporarily paused.');
    expect(personalStatusDescription('Completed')).toBe('Project work is complete.');
    expect(personalStatusDescription('Cancelled')).toBe('Project has been cancelled.');
  });

  it('returns null for legacy Personal-compatible statuses', () => {
    expect(personalStatusDescription('WaitingForInformation')).toBeNull();
    expect(personalStatusDescription('WaitingForSales')).toBeNull();
    expect(personalStatusDescription('InternalReview')).toBeNull();
    expect(personalStatusDescription('ReadyToIssue')).toBeNull();
    expect(personalStatusDescription('Issued')).toBeNull();
  });
});
