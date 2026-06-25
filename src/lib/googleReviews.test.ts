import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeGoogleBusinessProfileReviewList,
  normalizeGoogleReviewAverage,
  normalizeGoogleReviewItems,
  normalizeGoogleReviewRating,
} from "./googleReviews";

test("normalizes Google review ratings and aggregate counts", () => {
  assert.equal(normalizeGoogleReviewRating("FIVE"), 5);
  assert.equal(normalizeGoogleReviewRating("two"), 2);
  assert.equal(normalizeGoogleReviewRating(9), 5);
  assert.equal(normalizeGoogleReviewRating("bad", 4), 4);
  assert.equal(normalizeGoogleReviewAverage("4.56"), 4.6);
});

test("normalizes manual Google review items for block rendering", () => {
  const reviews = normalizeGoogleReviewItems([
    {
      id: "r1",
      reviewerName: "Ana",
      reviewerPhotoUrl: "https://example.com/a.jpg",
      reviewerProfileUrl: "javascript:alert(1)",
      rating: 4.8,
      comment: "Great service",
      createTime: "2026-06-20",
    },
    "Helpful staff",
  ]);

  assert.equal(reviews.length, 2);
  assert.equal(reviews[0]?.reviewerName, "Ana");
  assert.equal(reviews[0]?.reviewerProfileUrl, "");
  assert.equal(reviews[0]?.rating, 5);
  assert.match(reviews[0]?.createTime ?? "", /^2026-06-20T/);
  assert.equal(reviews[1]?.comment, "Helpful staff");
  assert.equal(reviews[1]?.rating, 5);
});

test("maps Business Profile review list responses into block data", () => {
  const payload = normalizeGoogleBusinessProfileReviewList({
    averageRating: 4.7,
    totalReviewCount: "38",
    nextPageToken: "next",
    reviews: [
      {
        name: "accounts/1/locations/2/reviews/abc",
        starRating: "FOUR",
        comment: "Fresh food",
        createTime: "2026-05-01T10:00:00Z",
        reviewer: {
          displayName: "Carlos",
          profilePhotoUrl: "https://example.com/carlos.png",
        },
        reviewReply: {
          comment: "Thank you",
          updateTime: "2026-05-02T10:00:00Z",
        },
      },
    ],
  });

  assert.equal(payload.averageRating, 4.7);
  assert.equal(payload.totalReviewCount, 38);
  assert.equal(payload.nextPageToken, "next");
  assert.equal(payload.reviews[0]?.id, "accounts/1/locations/2/reviews/abc");
  assert.equal(payload.reviews[0]?.reviewerName, "Carlos");
  assert.equal(payload.reviews[0]?.rating, 4);
  assert.equal(payload.reviews[0]?.replyComment, "Thank you");
});
