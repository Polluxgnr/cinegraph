"use client";

import AskPeople from "@/components/AskPeople";
import { useT } from "@/lib/i18n";

/** Agora, on its own page: ask anything and get a cited answer from what people actually say. */
export default function AskPage() {
  const T = useT();
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-4xl md:text-5xl">{T("Ask people")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          {T("Agora reads what real people say (Reddit, YouTube comments, Google Maps reviews, forums…) and answers with sources: what most agree on, where they disagree, the warnings. Each film, place, recipe, brand and team page has it too, with questions about that page.")}
        </p>
      </header>
      <AskPeople suggestions={[
        T("Best hidden spots in Lisbon"), T("Is the Arc'teryx Beta worth it?"), T("Underrated sci-fi series"),
        T("Best ramen in Paris"), T("Which running shoes for flat feet?"), T("Is PSG's midfield good this season?"),
      ]} />
    </div>
  );
}
