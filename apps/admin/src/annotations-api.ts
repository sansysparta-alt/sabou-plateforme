import type { Annotation, AnnotationTarget, NewAnnotation } from '@sabou/types';
import { call } from './accounts-api';

// Annotations du Comité scientifique (US-064). La base ne les montre qu'au Comité et à la DG,
// et n'accepte que celles du Comité.
export const listAnnotations = (type: AnnotationTarget, code: string) =>
  call<Annotation[]>(`/api/annotations?${new URLSearchParams({ type, code })}`);

export const addAnnotation = (input: NewAnnotation) =>
  call<Annotation[]>('/api/annotations', input);
