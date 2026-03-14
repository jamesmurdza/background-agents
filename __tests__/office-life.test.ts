/**
 * Corporate Office Life Simulator Tests
 * Because work-life balance is just a myth
 */

describe('Office Life Simulator', () => {
  const COFFEE_THRESHOLD = 3;
  let coffeeCount = 0;
  let productivityLevel = 0;

  beforeEach(() => {
    coffeeCount = 0;
    productivityLevel = 0;
  });

  it('should not function before coffee', () => {
    const developerBrain = () => {
      if (coffeeCount < COFFEE_THRESHOLD) {
        throw new Error('System not initialized. Insert coffee.');
      }
      return 'Hello World';
    };

    expect(() => developerBrain()).toThrow('System not initialized. Insert coffee.');
  });

  it('should calculate true meeting productivity', () => {
    const meetingDuration = 60; // minutes
    const actualWorkDone = 5; // minutes
    const emailsChecked = 47;
    const timesZonedOut = 12;

    const productivity = (actualWorkDone / meetingDuration) * 100;
    expect(productivity).toBeLessThan(10);
    expect(emailsChecked).toBeGreaterThan(actualWorkDone);
  });

  it('should prove lunch break is never long enough', () => {
    const scheduledLunch = 60; // minutes
    const actualLunch = 12; // minutes (grabbed a sad desk salad)
    const timeSpentInSlack = 48;

    expect(actualLunch + timeSpentInSlack).toBe(scheduledLunch);
    expect(actualLunch).toBeLessThan(scheduledLunch / 2);
  });

  it('should handle "quick" standup meetings', () => {
    const promisedDuration = 15; // minutes
    const actualDuration = 47; // minutes
    const topicsDiscussed = ['What I did yesterday', 'Weather', 'Sports', 'That one bug from 2019'];

    expect(actualDuration).toBeGreaterThan(promisedDuration * 3);
    expect(topicsDiscussed).toContain('Weather');
    expect(topicsDiscussed).not.toContain('Actual blockers');
  });

  it('should validate Friday productivity levels', () => {
    const dayOfWeek = 'Friday';
    const plannedTasks = 10;
    const completedTasks = 1; // And it was closing Jira tabs

    const fridayFactor = dayOfWeek === 'Friday' ? 0.1 : 1;
    expect(completedTasks).toBe(Math.floor(plannedTasks * fridayFactor));
  });

  it('should confirm Slack is always interrupting', () => {
    let deepWorkMinutes = 0;
    const slackPings = ['hey', 'quick question', 'got a sec?', 'ping', '??'];

    slackPings.forEach(() => {
      deepWorkMinutes = 0; // Reset every time
    });

    expect(deepWorkMinutes).toBe(0); // Deep work is a myth
  });
});
