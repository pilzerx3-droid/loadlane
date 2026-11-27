import { Button } from "@loadlane/ui";
import { CenteredCard } from "../components/notices";

export default function NotFound() {
  return (
    <CenteredCard>
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-muted-foreground">This page does not exist or has moved.</p>
      <Button asChild>
        <a href="/">Go to the start page</a>
      </Button>
    </CenteredCard>
  );
}
