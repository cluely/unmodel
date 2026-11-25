/**
 * Type-level tests for the higgsfield provider. NOT run by `bun test` — this
 * file is only type-checked (`bun run check` / tsc --noEmit). They exercise
 * the by-id narrowing, which is this provider's whole compile-time story: one
 * address for 87 video routes, with the body typed from the one route the
 * call names.
 *
 * Catalog-coupled on purpose. A refresh that changes one of these routes has
 * to surface here as a diff a human reads, not as a silent change in a
 * caller's code.
 */
import {
  characterTrain,
  checkRequestStatus,
  image,
  imageEdit,
  video,
  HIGGSFIELD_CUSTOM_REFERENCE_STATUSES,
  HIGGSFIELD_REQUEST_STATUSES,
  HIGGSFIELD_TERMINAL_STATUSES,
  HIGGSFIELD_UPLOAD_CONTENT_TYPES,
  HIGGSFIELD_WEBHOOK_STATUSES,
  type HiggsfieldEndpointId,
  type HiggsfieldImageEditEndpointId,
  type HiggsfieldImageEndpointId,
  type HiggsfieldVideoEndpointId,
} from "../../src/providers/higgsfield";
import type {
  CharacterTrainBody,
  CustomReferenceStatus,
  HiggsfieldModelId,
  HiggsfieldRequestStatus,
  ImageBody,
  ImageEditBody,
  RequestStatus,
  RequestStatusValue,
  UploadUrlRequest,
  VideoBody,
  WebhookDelivery,
} from "../../src/providers/higgsfield/types";
import type { HiggsfieldClient } from "@higgsfield/client/v2";
import { expectAssignable, expectTrue, type HasLiteralMember, type IsNever, type KeyIn } from "./helpers";

/** The second argument of the real client's `subscribe` (`@higgsfield/client/v2`). */
type SubscribeOptions = Parameters<HiggsfieldClient["subscribe"]>[1];

const IMG = "https://example.com/a.png";
const VID = "https://example.com/a.mp4";
const HOOK = "https://hooks.example.com/hf";

/** `true` only when the two types are mutually assignable. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

function videoTypeTests(): void {
  // A known id narrows the body to that route's own interface.
  const v = video({ endpoint: "bytedance/seedance-2.5/text-to-video", prompt: "a fox", resolution: "720p", duration: 5, draft: false });
  expectAssignable<string>(v.request.url);
  expectAssignable<"POST">(v.request.method);
  // The body is typed as the route's own interface, vocabulary and all.
  expectTrue<Same<typeof v.resolution, "480p" | "720p" | "1080p" | undefined>>();

  // The two URL parameters are not part of the validated body…
  const hooked = video({ endpoint: "bytedance/seedance-2.5/text-to-video", prompt: "a fox", hf_webhook: HOOK });
  expectTrue<IsNever<KeyIn<typeof hooked, "endpoint">>>();
  expectTrue<IsNever<KeyIn<typeof hooked, "hf_webhook">>>();
  expectTrue<IsNever<KeyIn<typeof v, "endpoint">>>();
  // …and `.toSdk` is the client's second argument: the body as `input`, and
  // the webhook the URL carries.
  expectAssignable<{ input: { prompt: string }; webhook: { url: string } }>(hooked.toSdk("higgsfield"));
  // Without a webhook it is `{ input }` and nothing else, which the real
  // client's `subscribe` takes as written.
  expectTrue<Same<keyof ReturnType<typeof v.toSdk<"higgsfield">>, "input">>();
  // A webhook that may be absent is an optional `webhook`; a stated one is definite.
  const maybe = video({ endpoint: "bytedance/seedance-2.5/text-to-video", prompt: "a fox", hf_webhook: HOOK as string | undefined });
  expectTrue<Same<ReturnType<typeof maybe.toSdk<"higgsfield">>["webhook"], { url: string } | undefined>>();
  expectTrue<Same<ReturnType<typeof hooked.toSdk<"higgsfield">>["webhook"], { url: string }>>();
  expectAssignable<SubscribeOptions>(v.toSdk("higgsfield"));
  expectAssignable<SubscribeOptions>({ ...hooked.toSdk("higgsfield"), webhook: { url: HOOK, secret: "s" } });
  // @ts-expect-error — the client types `webhook.secret` as required, and unmodel does not invent one.
  expectAssignable<SubscribeOptions>(hooked.toSdk("higgsfield"));
  expectTrue<IsNever<KeyIn<ReturnType<typeof hooked.toSdk<"higgsfield">>["input"], "endpoint" | "hf_webhook">>>();
  // @ts-expect-error — one SDK target.
  v.toSdk("fal");

  // @ts-expect-error — Seedance 2.5 lists 480p / 720p / 1080p.
  video({ endpoint: "bytedance/seedance-2.5/text-to-video", prompt: "a", resolution: "4k" });
  // …and Seedance 2.0 does have 4k: the vocabulary is the route's own.
  video({ endpoint: "bytedance/seedance-2.0/text-to-video", prompt: "a", resolution: "4k" });
  // @ts-expect-error — `prompt` is required on this route.
  video({ endpoint: "bytedance/seedance-2.5/text-to-video", resolution: "720p" });
  // `duration` is `required` with a default on LTX-2.5, and Higgsfield fills it before it validates.
  video({ endpoint: "lightricks/ltx-2.5/text-to-video/fast", prompt: "a fox" });
  // @ts-expect-error — an excess key is an error, not a silent pass-through.
  video({ endpoint: "bytedance/seedance-2.5/text-to-video", prompt: "a", promt: "a" });
  // @ts-expect-error — a sibling route's key is an excess key here.
  video({ endpoint: "bytedance/seedance-2.5/text-to-video", prompt: "a", image_url: IMG });
  // @ts-expect-error — `duration` is a number.
  video({ endpoint: "bytedance/seedance-2.5/text-to-video", prompt: "a", duration: "5" });

  // A required non-prompt field is required by type.
  video({ endpoint: "higgsfield/genjutsu/restyle/v1.0", video_url: VID, preset_id: "c2143317-f28d-4c3c-a0b8-39bd547e08a7" });
  // @ts-expect-error — Restyle needs its preset.
  video({ endpoint: "higgsfield/genjutsu/restyle/v1.0", video_url: VID });

  // A media path is closed at the root against the route's own body.
  video.safe(
    { endpoint: "higgsfield/genjutsu/motion-transfer/v1.0", video_url: VID, image_urls: [IMG] },
    { media: [{ path: ["video_url"], durationSeconds: 12 }] },
  );
  video.safe(
    { endpoint: "higgsfield/genjutsu/motion-transfer/v1.0", video_url: VID, image_urls: [IMG] },
    // @ts-expect-error — `clip` is not a key of these params.
    { media: [{ path: ["clip"], durationSeconds: 12 }] },
  );

  // An IMAGE route's id is `never` at the video address: the type says it
  // belongs elsewhere, while the runtime only signposts it.
  // @ts-expect-error
  video({ endpoint: "higgsfield-ai/soul/standard", prompt: "a" });

  // An id unmodel has no row for is loose: any body, no excess-key error.
  const loose = video({ endpoint: "maker/brand-new/text-to-video", prompt: "a", anything: [1, 2, 3], hf_webhook: HOOK });
  expectAssignable<string>(loose.request.url);
  // A dynamically-typed id is loose too.
  const dynamic: string = "bytedance/seedance-2.5/text-to-video";
  video({ endpoint: dynamic, whatever: true });
}

function imageTypeTests(): void {
  const i = image({ endpoint: "higgsfield-ai/soul/standard", prompt: "a", resolution: "1080p", batch_size: 4, seed: null });
  expectTrue<Same<typeof i.seed, number | null | undefined>>();
  // @ts-expect-error — Soul takes 720p / 1080p, not a tier.
  image({ endpoint: "higgsfield-ai/soul/standard", prompt: "a", resolution: "2k" });
  // @ts-expect-error — a batch is 1 or 4.
  image({ endpoint: "higgsfield-ai/soul/standard", prompt: "a", batch_size: 2 });
  // Marketing Studio's `resolution` is a tier.
  image({ endpoint: "marketing-studio/image", prompt: "a", resolution: "2k" });
  // A nested object is typed to its own depth.
  image({ endpoint: "recraft/v4.1/text-to-image", prompt: "a", background_color: { rgb: [0, 0, 0] } });
  // @ts-expect-error — `rgb` is a list of numbers.
  image({ endpoint: "recraft/v4.1/text-to-image", prompt: "a", background_color: { rgb: "black" } });

  // A VIDEO route's id is `never` at the image address.
  // @ts-expect-error
  image({ endpoint: "bytedance/seedance-2.5/text-to-video", prompt: "a" });

  // The view takes its ten routes…
  imageEdit({ endpoint: "alibaba/qwen-image-3/edit", prompt: "a", image_urls: [IMG] });
  imageEdit({ endpoint: "ideogram/v4.0", prompt: "a fox", image_url: IMG });
  // …and an image route outside it is `never` there, though `image` takes it.
  // @ts-expect-error
  imageEdit({ endpoint: "z-image/turbo", prompt: "a" });
  image({ endpoint: "z-image/turbo", prompt: "a" });
  // @ts-expect-error — the vendor files AI Influencer under image_edit; unmodel does not.
  imageEdit({ endpoint: "higgsfield/ai-influencer", image_url: IMG });
}

function characterTrainTypeTests(): void {
  const c = characterTrain({ name: "Mara", model_version: "v2", input_images: [{ type: "image_url", image_url: IMG }] });
  expectAssignable<string>(c.request.url);
  expectAssignable<CharacterTrainBody>(c.toSdk("higgsfield"));
  // @ts-expect-error — `input_images` is required.
  characterTrain({ name: "Mara" });
  // @ts-expect-error — the item's `type` is the constant "image_url".
  characterTrain({ name: "Mara", input_images: [{ type: "file", image_url: IMG }] });
  // @ts-expect-error — v1, v2 or cinema.
  characterTrain({ name: "Mara", input_images: [], model_version: "v3" });
  // @ts-expect-error — training takes no webhook.
  characterTrain({ name: "Mara", input_images: [], hf_webhook: HOOK });
}

function aliasAndIdTypeTests(): void {
  // The aliases are the JSON body: no `endpoint`, no `hf_webhook`.
  expectAssignable<VideoBody<"bytedance/seedance-2.5/text-to-video">>({ prompt: "a", resolution: "720p", duration: 5 });
  expectTrue<IsNever<KeyIn<VideoBody<"bytedance/seedance-2.5/text-to-video">, "endpoint" | "hf_webhook">>>();
  expectAssignable<ImageBody<"higgsfield-ai/soul/standard">>({ prompt: "a" });
  expectAssignable<ImageEditBody<"alibaba/qwen-image-3/edit">>({ prompt: "a", image_urls: [IMG] });

  // The id unions partition, and the view is a subset of the image union.
  expectTrue<Same<HiggsfieldEndpointId, HiggsfieldImageEndpointId | HiggsfieldVideoEndpointId>>();
  expectTrue<IsNever<HiggsfieldImageEndpointId & HiggsfieldVideoEndpointId>>();
  expectTrue<IsNever<Exclude<HiggsfieldImageEditEndpointId, HiggsfieldImageEndpointId>>>();
  expectTrue<HasLiteralMember<HiggsfieldModelId, "v1/custom-references">>();
  expectTrue<HasLiteralMember<HiggsfieldModelId, "z-image/turbo">>();
}

function statusTypeTests(): void {
  // The value tuples ARE the wire unions: neither can gain a member alone.
  expectTrue<Same<(typeof HIGGSFIELD_REQUEST_STATUSES)[number], RequestStatusValue>>();
  expectTrue<Same<(typeof HIGGSFIELD_REQUEST_STATUSES)[number], RequestStatus["status"]>>();
  expectTrue<Same<(typeof HIGGSFIELD_REQUEST_STATUSES)[number], "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled">>();
  expectTrue<IsNever<Exclude<(typeof HIGGSFIELD_TERMINAL_STATUSES)[number], RequestStatusValue>>>();
  expectTrue<Same<(typeof HIGGSFIELD_WEBHOOK_STATUSES)[number], WebhookDelivery["status"]>>();
  expectTrue<IsNever<Exclude<(typeof HIGGSFIELD_WEBHOOK_STATUSES)[number], (typeof HIGGSFIELD_TERMINAL_STATUSES)[number]>>>();
  expectTrue<Same<(typeof HIGGSFIELD_CUSTOM_REFERENCE_STATUSES)[number], CustomReferenceStatus>>();
  expectTrue<Same<(typeof HIGGSFIELD_UPLOAD_CONTENT_TYPES)[number], UploadUrlRequest["content_type"]>>();

  // The checker takes a status document as published, and reports its status
  // with the literal members intact.
  const status: RequestStatus = { status: "completed", request_id: "r", images: [{ url: IMG, index: 0 }], errors: [] };
  const report = checkRequestStatus(status);
  expectAssignable<HiggsfieldRequestStatus | undefined>(report.finishReason);
  expectTrue<HasLiteralMember<HiggsfieldRequestStatus, "nsfw">>();
  // An error body is accepted without a cast.
  checkRequestStatus({ detail: { code: "account_queue_full", message: "full", retryable: true } });
  checkRequestStatus({ detail: "Invalid credentials" });
}

void videoTypeTests;
void imageTypeTests;
void characterTrainTypeTests;
void aliasAndIdTypeTests;
void statusTypeTests;
