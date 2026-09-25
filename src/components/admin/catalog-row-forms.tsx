"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addEvidenceAction, setMaturityAction, setPublishedAction } from "@/server/actions/admin";
import { RELEASE_GATES, RELEASE_GATE_LABELS } from "@/security/taxonomy";
import { AdminForm } from "./admin-form";

const selectClass =
  "h-11 rounded-md border border-input bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

export function PublishToggle({ slug, published }: { slug: string; published: boolean }) {
  return (
    <AdminForm action={setPublishedAction} inline>
      {(pending) => (
        <>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="published" value={String(!published)} />
          <Button type="submit" size="sm" variant="outline" className="min-h-11" disabled={pending}>
            {published ? "Unpublish" : "Publish"}
          </Button>
        </>
      )}
    </AdminForm>
  );
}

export function MaturityForm({ slug, maturity }: { slug: string; maturity: string }) {
  return (
    <AdminForm action={setMaturityAction} inline>
      {(pending) => (
        <>
          <input type="hidden" name="slug" value={slug} />
          <label className="sr-only" htmlFor={`maturity-${slug}`}>
            Maturity for {slug}
          </label>
          <select id={`maturity-${slug}`} name="maturity" defaultValue={maturity} className={selectClass}>
            <option value="READY">READY</option>
            <option value="CONFIGURABLE">CONFIGURABLE</option>
            <option value="CUSTOM">CUSTOM</option>
          </select>
          <Button type="submit" size="sm" className="min-h-11" disabled={pending}>
            Set
          </Button>
        </>
      )}
    </AdminForm>
  );
}

export function EvidenceForm({ slug }: { slug: string }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <AdminForm action={addEvidenceAction}>
      {(pending) => (
        <>
          <input type="hidden" name="slug" value={slug} />
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor={`gate-${slug}`}>Gate</Label>
              <select id={`gate-${slug}`} name="gate" className={`${selectClass} w-full`}>
                {RELEASE_GATES.map((g) => (
                  <option key={g} value={g}>
                    {RELEASE_GATE_LABELS[g]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`ref-${slug}`}>Evidence reference</Label>
              <Input id={`ref-${slug}`} name="ref" required minLength={3} maxLength={500} placeholder="CI run URL or report id" className="h-11" />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`date-${slug}`}>Verified on</Label>
              <Input id={`date-${slug}`} name="verifiedAt" type="date" required defaultValue={today} className="h-11" />
            </div>
          </div>
          <Button type="submit" size="sm" variant="outline" className="min-h-11" disabled={pending}>
            Record passing evidence
          </Button>
        </>
      )}
    </AdminForm>
  );
}
