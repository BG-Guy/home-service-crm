import "server-only";
import { eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import { properties, signatures } from "@/db/schema";
import { contactRevealedFor } from "@/features/customers/api";
import {
  addressLines,
  type DocCompany,
  loadDocCompany,
} from "@/features/invoices/doc";
import { areaLine, maskEstimateDoc } from "@/features/invoices/masking";
import { getMediaUrls, listJobPhotos } from "@/features/media/api";
import { previewDeposit } from "@/features/payments/api";
import type { PolicyVersionRow } from "@/lib/policies";
import { findCompany } from "@/lib/settings";
import type { SessionUser } from "@/lib/types";
import {
  DEFAULT_ESIGN_CONSENT,
  estimateNeedsCoolingOff,
  estimatePolicies,
  type LoadedEstimate,
  loadEstimate,
} from "./api";

// Read model for the estimate print page, the public /e/ page and the builder's
// side panels. NO permission checks — callers authorize first.

export interface EstimateDepositPreview {
  amountCents: number;
  ruleName: string;
  policyShort: string;
  capWarning: string | null;
}

export interface EstimateSignatureView {
  id: string;
  signerName: string;
  channel: string;
  signedAt: Date;
  docSha256: string;
  ip: string | null;
  userAgent: string | null;
  lat: number | null;
  lng: number | null;
  esignConsent: boolean;
  consentText: string | null;
  imageUrl: string | null;
}

export interface EstimateDoc extends LoadedEstimate {
  company: DocCompany;
  propertyLines: string[];
  /** City/state/ZIP only: what a viewer outside the contact window sees. */
  propertyAreaLines: string[];
  policies: PolicyVersionRow[];
  coolingOff: boolean;
  consentText: string;
  deposits: Record<string, EstimateDepositPreview | null>;
  signature: EstimateSignatureView | null;
  problemPhotos: {
    id: string;
    url: string;
    thumbUrl: string;
    caption: string | null;
  }[];
  timezone: string;
}

async function signatureView(
  id: string,
): Promise<EstimateSignatureView | null> {
  const [s] = await db
    .select()
    .from(signatures)
    .where(eq(signatures.id, id))
    .limit(1);
  if (!s) return null;
  const urls = s.signatureMediaId
    ? await getMediaUrls([s.signatureMediaId], "full")
    : {};
  return {
    id: s.id,
    signerName: s.signerName,
    channel: s.channel,
    signedAt: s.signedAt,
    docSha256: s.docSha256,
    ip: s.ip,
    userAgent: s.userAgent,
    lat: s.lat,
    lng: s.lng,
    esignConsent: s.esignConsent,
    consentText: s.consentText,
    imageUrl: s.signatureMediaId ? (urls[s.signatureMediaId] ?? null) : null,
  };
}

export const loadEstimateDoc = cache(
  async (estimateId: string): Promise<EstimateDoc | null> => {
    const loaded = await loadEstimate(estimateId);
    if (!loaded) return null;
    const est = loaded.estimate;
    const coolingOff = estimateNeedsCoolingOff(loaded);
    const propertyId = est.propertyId ?? loaded.job?.propertyId ?? null;
    const [company, policies, prop, tz, sig, photos, ...deps] =
      await Promise.all([
        loadDocCompany(),
        estimatePolicies(coolingOff),
        propertyId
          ? db
              .select()
              .from(properties)
              .where(eq(properties.id, propertyId))
              .limit(1)
              .then((r) => r[0] ?? null)
          : Promise.resolve(null),
        findCompany().then((c) => c?.timezone ?? "America/New_York"),
        est.signatureId
          ? signatureView(est.signatureId)
          : Promise.resolve(null),
        est.jobId && est.showPhotos
          ? est.photoMediaIds.length
            ? // Staff-chosen selection (estimates.photo_media_ids), in that order.
              listJobPhotos(est.jobId)
                .then((all) =>
                  est.photoMediaIds
                    .map((id) => all.find((p) => p.id === id))
                    .filter((p): p is NonNullable<typeof p> => !!p),
                )
                .catch(() => [])
            : listJobPhotos(est.jobId, { tags: ["problem"], limit: 8 }).catch(
                () => [],
              )
          : Promise.resolve([]),
        ...loaded.options.map((o) =>
          previewDeposit({ estimateId: est.id, optionId: o.id }).catch(
            () => null,
          ),
        ),
      ]);
    const deposits: Record<string, EstimateDepositPreview | null> = {};
    loaded.options.forEach((o, i) => {
      const d = deps[i] as EstimateDepositPreview | null | undefined;
      deposits[o.id] = d
        ? {
            amountCents: d.amountCents,
            ruleName: d.ruleName,
            policyShort: d.policyShort,
            capWarning: d.capWarning,
          }
        : null;
    });
    const esign = policies.find((p) => p.kind === "esign_consent");
    return {
      ...loaded,
      company,
      propertyLines: addressLines(prop),
      propertyAreaLines: [areaLine(prop)].filter((l): l is string => !!l),
      policies,
      coolingOff,
      consentText: esign?.body ?? DEFAULT_ESIGN_CONSENT,
      deposits,
      signature: sig,
      problemPhotos: photos.map((p) => ({
        id: p.id,
        url: p.url,
        thumbUrl: p.thumbUrl,
        caption: p.caption,
      })),
      timezone: tz,
    };
  },
);

/**
 * The estimate document for a staff viewer: contact details are masked outside
 * the viewer's contact window (SPEC §4.2). Callers authorize first.
 */
export async function loadEstimateDocForViewer(
  viewer: SessionUser,
  estimateId: string,
): Promise<EstimateDoc | null> {
  const doc = await loadEstimateDoc(estimateId);
  if (!doc) return null;
  const { revealed } = await contactRevealedFor(viewer, doc.customer.id);
  return revealed ? doc : maskEstimateDoc(doc);
}
