export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export function logFirestoreError(error: unknown, operationType: OperationType, path: string | null, userId?: string) {
  console.error('Firestore Listener Error:', {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
    userId
  });
}
