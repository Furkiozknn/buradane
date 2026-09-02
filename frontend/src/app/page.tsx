import { AppShell } from "@/components/AppShell";
import { datasetMeta } from "@/lib/places-repository";

/** Server component: reads dataset metadata (source, license, generation
 * date) once at request time so the client bundle never ships the 3.5MB
 * snapshot - only query results cross the wire. */
export default function Home() {
  const meta = datasetMeta();
  return <AppShell datasetMeta={{ attribution: meta.attribution, generatedAt: meta.generated_at, count: meta.count }} />;
}
