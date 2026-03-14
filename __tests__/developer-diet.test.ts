/**
 * Developer Diet and Lifestyle Tests
 * Testing the nutritional choices of code monkeys everywhere
 */

describe('Developer Nutrition Analysis', () => {
  interface Meal {
    name: string;
    calories: number;
    wasEatenAtDesk: boolean;
    timeToConsume: number; // seconds
  }

  it('should validate energy drink consumption patterns', () => {
    const hourlyEnergyDrinks = [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 2, 2, 1, 0, 0, 0, 0, 0, 0, 1, 2, 1];
    const totalCaffeine = hourlyEnergyDrinks.reduce((a, b) => a + b, 0);

    expect(totalCaffeine).toBeGreaterThan(10);
    expect(hourlyEnergyDrinks[3]).toBe(0); // 3 AM: asleep... or are we?
    expect(hourlyEnergyDrinks[22]).toBe(1); // 10 PM: debugging session starts
  });

  it('should confirm pizza is a complete food group', () => {
    const pizzaContains = ['carbs', 'protein', 'fat', 'vegetables', 'happiness'];
    const foodGroups = ['carbs', 'protein', 'fat', 'vegetables', 'dairy'];

    const coverage = foodGroups.filter(group =>
      pizzaContains.includes(group) || group === 'dairy' // cheese is on pizza
    );

    expect(coverage.length).toBe(foodGroups.length);
    expect(pizzaContains).toContain('happiness'); // The most important nutrient
  });

  it('should calculate time since last vegetable', () => {
    const lastVegetableDate = new Date('2024-01-01');
    const today = new Date();
    const daysSinceVegetable = Math.floor(
      (today.getTime() - lastVegetableDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Ketchup counts as a vegetable, right?
    expect(daysSinceVegetable).toBeGreaterThan(0);
    // We're not judging, just observing
  });

  it('should validate the developer lunch algorithm', () => {
    const lunchDecision = (deadline: boolean, codeCompiling: boolean): Meal => {
      if (deadline) {
        return { name: 'Vending machine mystery', calories: 500, wasEatenAtDesk: true, timeToConsume: 30 };
      }
      if (codeCompiling) {
        return { name: 'Whatever is closest', calories: 800, wasEatenAtDesk: true, timeToConsume: 120 };
      }
      return { name: 'Actual food', calories: 600, wasEatenAtDesk: false, timeToConsume: 1800 };
    };

    const typicalLunch = lunchDecision(true, true);
    expect(typicalLunch.wasEatenAtDesk).toBe(true);
    expect(typicalLunch.timeToConsume).toBeLessThan(60); // Inhaled, not eaten
  });

  it('should track hydration levels (spoiler: dehydrated)', () => {
    const dailyFluids = {
      water: 1,      // glasses
      coffee: 8,     // cups
      energyDrinks: 3,
      sadDeskSoda: 2
    };

    const caffeineVsWater = (dailyFluids.coffee + dailyFluids.energyDrinks) / dailyFluids.water;
    expect(caffeineVsWater).toBeGreaterThan(5);
    expect(dailyFluids.water).toBeLessThan(dailyFluids.coffee); // Accurate
  });
});
