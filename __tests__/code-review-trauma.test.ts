/**
 * Code Review PTSD Simulator
 * Relive your worst code review moments in test form
 */

describe('Code Review Trauma Suite', () => {
  const reviewerMoods = ['nitpicky', 'philosophical', 'passive-aggressive', 'actually-helpful'] as const;

  it('should handle the "just one small thing" that blocks merge', () => {
    const pr = {
      linesChanged: 3,
      reviewComments: 47,
      blockers: ['Missing period in comment', 'Variable could be more descriptive', 'Have you considered rewriting in Rust?'],
      daysOpen: 14
    };

    expect(pr.reviewComments).toBeGreaterThan(pr.linesChanged * 10);
    expect(pr.blockers).toContain('Missing period in comment');
  });

  it('should parse passive-aggressive review comments', () => {
    const comments = [
      "Interesting approach...",
      "This works, but...",
      "Not sure if this is the best way",
      "Per my last comment...",
      "Just curious why you chose this?",
      "I guess this is fine"
    ];

    const passiveAggressiveCount = comments.filter(c =>
      c.includes('...') || c.includes('but') || c.includes('curious') || c.includes('guess')
    ).length;

    expect(passiveAggressiveCount).toBe(comments.length); // All of them
  });

  it('should validate reviewer consistency', () => {
    const lastWeek = { approach: 'Use inheritance', reviewer: 'senior_dev' };
    const thisWeek = { approach: 'Prefer composition', reviewer: 'senior_dev' };
    const yourApproach = { approach: 'Use inheritance', reviewer: 'you' };

    expect(lastWeek.approach).not.toBe(thisWeek.approach);
    expect(lastWeek.reviewer).toBe(thisWeek.reviewer);
    expect(yourApproach.approach).toBe(lastWeek.approach); // You can't win
  });

  it('should measure time to address "quick fix" comments', () => {
    const quickFixEstimate = 5; // minutes
    const actualTime = {
      understandingComment: 30,
      realizingItsNotQuick: 15,
      actualFix: 120,
      creatingNewBugs: 60,
      fixingNewBugs: 180,
      secondReview: 1440 // waiting 24 hours
    };

    const totalTime = Object.values(actualTime).reduce((a, b) => a + b, 0);
    expect(totalTime).toBeGreaterThan(quickFixEstimate * 100);
  });

  it('should handle the "LGTM" after 3 weeks', () => {
    const prTimeline = {
      submitted: new Date('2024-01-01'),
      firstComment: new Date('2024-01-08'),   // "needs changes"
      yourResponse: new Date('2024-01-08'),    // same day!
      secondComment: new Date('2024-01-15'),   // "still needs changes"
      yourSecondResponse: new Date('2024-01-15'),
      lgtm: new Date('2024-01-22'),            // finally
      mergeConflicts: new Date('2024-01-22'),  // of course
      actualMerge: new Date('2024-02-01')
    };

    const daysToMerge = Math.floor(
      (prTimeline.actualMerge.getTime() - prTimeline.submitted.getTime()) / (1000 * 60 * 60 * 24)
    );

    expect(daysToMerge).toBeGreaterThan(30);
    expect(prTimeline.mergeConflicts).toEqual(prTimeline.lgtm); // Murphy's Law
  });

  it('should quantify the fear of red comments', () => {
    const notification = '🔴 Changes requested';
    const heartRate = notification.includes('Changes requested') ? 180 : 60;
    const anxietyLevel = notification.includes('🔴') ? 'maximum' : 'normal';

    expect(heartRate).toBeGreaterThan(150);
    expect(anxietyLevel).toBe('maximum');
  });
});
