import { AppShell } from "@/components/AppShell";
import { datasetMeta } from "@/lib/places-repository";
import { EMPTY_URL_STATE, parseUrlState } from "@/lib/url-state";

/**
 * Server component: reads dataset metadata (source, license, generation
 * date) once at request time so the client bundle never ships the 3.5MB
 * snapshot - only query results cross the wire.
 *
 * The shared-link state is parsed HERE rather than from `window` inside the
 * client component. Reading the URL during a client render makes the server
 * and client disagree about the first paint (React hydration error #418) and
 * either flashes default state or shifts the layout once the link is applied.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const meta = datasetMeta();
  const params = await searchParams;

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") search.set(key, value);
    else if (Array.isArray(value) && value[0] !== undefined) search.set(key, value[0]);
  }

  const initialState = search.size > 0 ? parseUrlState(search.toString()) : EMPTY_URL_STATE;

  return (
    <AppShell
      datasetMeta={{ attribution: meta.attribution, generatedAt: meta.generated_at, count: meta.count }}
      initialState={initialState}
    />
  );
}
