import { describe, it, expect } from 'vitest';
import { buildObservation } from './observe';
import type { ObserverRef } from './types';

const userRef: ObserverRef = { kind: 'user', id: 'user-1' };
const guestRef: ObserverRef = { kind: 'guest', localId: 'local-x' };

const baseLoc = {
  lat: 17.144, lng: -96.7447, accuracyM: 12, altitudeM: 1500, capturedFrom: 'gps' as const,
};

const baseMedia = [{
  blobId: 'b1',
  blob: new Blob(['x'], { type: 'image/jpeg' }),
  mimeType: 'image/jpeg',
  sizeBytes: 1,
  mediaType: 'photo' as const,
}];

describe('buildObservation', () => {
  it('fills required fields with sensible defaults', () => {
    const obs = buildObservation({
      observerRef: userRef,
      media: baseMedia,
      location: baseLoc,
    });
    expect(obs.id).toBeTruthy();
    expect(obs.observerRef).toEqual(userRef);
    expect(obs.photos).toHaveLength(1);
    expect(obs.photos[0].id).toBe('b1');
    expect(obs.photos[0].mediaType).toBe('photo');
    expect(obs.primaryPhotoIndex).toBe(0);
    expect(obs.evidenceType).toBe('direct_sighting');
    expect(obs.identification.scientificName).toBe('');
    expect(obs.identification.status).toBe('pending');
    expect(obs.syncStatus).toBe('pending');
  });

  it('respects an explicit id and createdAt', () => {
    const obs = buildObservation({
      id: 'fixed-id',
      createdAt: '2026-01-01T00:00:00.000Z',
      observerRef: userRef,
      media: baseMedia,
      location: baseLoc,
    });
    expect(obs.id).toBe('fixed-id');
    expect(obs.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('marks identification accepted when scientificName is provided', () => {
    const obs = buildObservation({
      observerRef: userRef,
      media: baseMedia,
      location: baseLoc,
      identification: { scientificName: 'Puma concolor', confidence: 0.9, source: 'plantnet' },
    });
    expect(obs.identification.status).toBe('accepted');
    expect(obs.identification.scientificName).toBe('Puma concolor');
    expect(obs.identification.confidence).toBe(0.9);
    expect(obs.identification.source).toBe('plantnet');
  });

  it('honours camera_trap evidenceType', () => {
    const obs = buildObservation({
      observerRef: userRef,
      media: baseMedia,
      location: baseLoc,
      evidenceType: 'camera_trap',
    });
    expect(obs.evidenceType).toBe('camera_trap');
  });

  it('preserves a guest observerRef without coercing it', () => {
    const obs = buildObservation({
      observerRef: guestRef,
      media: baseMedia,
      location: baseLoc,
    });
    expect(obs.observerRef.kind).toBe('guest');
  });

  it('maps multiple media inputs onto photos[]', () => {
    const obs = buildObservation({
      observerRef: userRef,
      media: [
        ...baseMedia,
        {
          blobId: 'a1',
          blob: new Blob([], { type: 'audio/webm' }),
          mimeType: 'audio/webm',
          sizeBytes: 2,
          mediaType: 'audio' as const,
        },
      ],
      location: baseLoc,
    });
    expect(obs.photos).toHaveLength(2);
    expect(obs.photos[1].mediaType).toBe('audio');
    expect(obs.photos[1].mimeType).toBe('audio/webm');
  });
});
