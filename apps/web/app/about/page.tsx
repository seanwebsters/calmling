import { Card, PageHeader } from '@/components/ui';

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-[900px] px-4 py-10 sm:px-6">
      <PageHeader eyebrow="About" title="One Calmling. One life. The whole world watching.">
        Calmling is an experiment in shared, persistent, autonomous character simulation.
      </PageHeader>
      <div className="space-y-5 text-[1.02rem] leading-relaxed text-ink-soft">
        <Card title="What you are watching">
          <p>There is exactly one Calmling. Everyone sees the same character, in the same world, at the same moment. Its life continues when nobody is watching — the simulation runs as a server process, not in your browser.</p>
        </Card>
        <Card title="How it decides">
          <p>Calmling has simulated needs, a personality that drifts slowly with experience, habits that form from repetition, and memories grounded in real events. A decision-maker (an LLM when configured, otherwise a deterministic utility AI) proposes what to do next from a list of currently possible actions. A deterministic engine checks every proposal — does the object exist, is it reachable, is the right tool available, is there enough energy — and only then does anything change.</p>
        </Card>
        <Card title="What you can and can't do">
          <p>You can send gifts, chat, vote and build things together. You cannot control Calmling. Messages are treated as untrusted observations; Calmling may notice the audience, or not. Gifts may be loved, moved, planted or ignored.</p>
        </Card>
        <Card title="Honest notes">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>The character shown is a <strong>temporary placeholder</strong>. The official Calmlings character and animations will replace it through the asset system.</li>
            <li>The live view is the shared simulation rendered in your browser in real time — it is not an encoded video stream.</li>
            <li>Needs, moods and “feelings” are simulated values, not real experiences.</li>
            <li>Diary entries are narrative interpretations written from verified events; the events are listed under each entry.</li>
            <li>Sign-in is a simple development login (a name, no password). Gifts are free and virtual.</li>
          </ul>
        </Card>
      </div>
    </main>
  );
}
