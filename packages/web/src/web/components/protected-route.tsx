import type { ReactNode } from "react";
import { Link } from "wouter";
import { LogIn } from "lucide-react";
import { useSession } from "../hooks/use-session";
import { EmptyState, Loading } from "./ui/kit";

/** Wraps pages whose data only exists for a signed-in learner. */
export function ProtectedRoute({ children, message }: { children: ReactNode; message?: string }) {
  const { isSignedIn, isPending } = useSession();

  if (isPending) return <Loading />;

  if (!isSignedIn) {
    return (
      <EmptyState
        icon={LogIn}
        title="Sign in to keep your progress"
        body={message ?? "Your streak, XP and review deck are tied to your account."}
        action={
          <Link
            to="/sign-in"
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Sign in
          </Link>
        }
      />
    );
  }

  return <>{children}</>;
}
