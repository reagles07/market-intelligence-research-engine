import { toast } from "sonner";

/** Surface rejected UI side effects instead of leaving unhandled promises. */
export function reportAsyncError(error: unknown, operation: string): void {
  console.error(`Failed ${operation}`, error);
  toast.error(`Could not complete ${operation}. Please try again.`);
}
