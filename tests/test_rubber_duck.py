"""
Test suite for Rubber Duck Debugging.

Dedicated to all the rubber ducks who have listened to our problems
and helped us solve them without saying a single word.
"""

import pytest


class RubberDuck:
    """A faithful debugging companion."""

    def __init__(self, name="Quackers"):
        self.name = name
        self.problems_solved = 0
        self.patience = float('inf')  # Unlimited patience

    def listen(self, problem: str) -> str:
        """The duck listens. The duck judges not."""
        self.problems_solved += 1
        return "🦆 *quack*"

    def stare(self) -> str:
        """Sometimes that's all it takes."""
        return "🦆 *stares meaningfully*"

    def judge(self) -> bool:
        """Ducks don't judge. That's why we love them."""
        return False


class TestRubberDuckDebugging:
    """Tests for humanity's greatest debugging technique."""

    @pytest.fixture
    def duck(self):
        """Every test deserves a fresh duck."""
        return RubberDuck(name="Sir Quacks-a-Lot")

    def test_duck_listens_without_interrupting(self, duck):
        """Unlike your coworkers."""
        problems = [
            "Why isn't this working?",
            "I've tried everything!",
            "Wait... oh no.",
            "I'm an idiot.",
            "Thanks, duck."
        ]

        for problem in problems:
            response = duck.listen(problem)
            assert response == "🦆 *quack*", "Duck should only quack supportively"

        assert duck.problems_solved == 5, "Duck helped solve 5 problems!"

    def test_duck_has_infinite_patience(self, duck):
        """More than any human ever could."""
        assert duck.patience == float('inf'), "Duck patience knows no bounds"

    def test_duck_never_judges(self, duck):
        """Even for THAT bug."""
        duck.listen("I spent 4 hours debugging only to find a typo")
        duck.listen("It was 'teh' instead of 'the'")
        duck.listen("In a variable name")
        duck.listen("That I wrote")

        assert not duck.judge(), "Duck understands. Duck has seen worse."

    def test_explaining_code_to_duck_reveals_bug(self, duck):
        """The magic of rubber duck debugging."""

        # The buggy code (can you spot it?)
        def calculate_average(numbers):
            total = sum(numbers)
            return total / len(numbers)  # BUG: What if numbers is empty?

        # Explaining to the duck...
        duck.listen("So I sum all the numbers...")
        duck.listen("Then I divide by the length...")
        duck.listen("Wait.")
        duck.listen("What if the list is empty?!")
        duck.stare()

        # Fixed version
        def calculate_average_fixed(numbers):
            if not numbers:
                return 0
            return sum(numbers) / len(numbers)

        assert calculate_average_fixed([]) == 0, "Duck helped find the bug!"

    def test_duck_is_always_available(self, duck):
        """3 AM? Duck is there."""
        import datetime

        current_hour = datetime.datetime.now().hour
        duck_available = True  # Always

        assert duck_available, f"It's {current_hour}:00 and duck is still here for you, James"

    def test_duck_keeps_secrets(self, duck):
        """Unlike Slack."""
        secrets = [
            "I don't actually understand recursion",
            "I still copy code from Stack Overflow",
            "I pretend to understand the codebase",
        ]

        for secret in secrets:
            duck.listen(secret)

        # Duck has no way to share secrets
        assert not hasattr(duck, 'share_secrets'), "Your secrets are safe"


class TestDifferentDucks:
    """Not all ducks are created equal."""

    def test_classic_yellow_duck(self):
        """The OG debugging companion."""
        duck = RubberDuck(name="Classic Yellow")
        assert duck.name == "Classic Yellow"

    def test_fancy_programmer_duck(self):
        """The one with the little glasses."""
        duck = RubberDuck(name="Professor Quackington")
        duck.listen("Explain monads to me")
        # Duck doesn't understand monads either, but won't admit it
        assert duck.problems_solved == 1

    def test_emotional_support_duck(self):
        """For when the code review is brutal."""
        duck = RubberDuck(name="Theraputic Quacker")
        duck.listen("They rejected my PR with 47 comments")
        assert duck.stare() == "🦆 *stares meaningfully*"


class TestAdvancedDebugging:
    """When one duck isn't enough."""

    def test_multiple_ducks_for_hard_problems(self):
        """Sometimes you need a whole team."""
        ducks = [RubberDuck(name=f"Duck #{i}") for i in range(5)]

        hard_problem = "Why is this working in development?"

        for duck in ducks:
            duck.listen(hard_problem)

        total_quacks = sum(d.problems_solved for d in ducks)
        assert total_quacks == 5, "Five ducks are better than one"

    def test_duck_vs_stackoverflow(self):
        """The ultimate showdown."""
        duck = RubberDuck()

        duck_benefits = [
            "No judgment",
            "No outdated answers",
            "No 'marked as duplicate'",
            "No 'why do you want to do that?'",
            "Always available",
        ]

        assert len(duck_benefits) >= 5, "Duck wins every time"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
