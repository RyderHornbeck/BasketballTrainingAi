export interface ShotCursor {
  exerciseId: string | null;
  drillName: string | null;
  setNumber: number | null;
}

export function bindShotToCursor(
  args: Record<string, unknown>,
  cursor: ShotCursor | null,
): Record<string, unknown> {
  if (!cursor?.exerciseId || !cursor.setNumber) return args;
  return {
    ...args,
    exercise_id: cursor.exerciseId,
    drill_name: cursor.drillName,
    set_number: cursor.setNumber,
  };
}

export function cursorMatches(
  cursor: ShotCursor | null,
  exerciseId: string | null | undefined,
  setNumber: number | null | undefined,
): boolean {
  return (
    cursor != null &&
    cursor.exerciseId === (exerciseId ?? null) &&
    cursor.setNumber === (setNumber ?? null)
  );
}
