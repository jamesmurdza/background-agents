"""
Test suite for Dad Jokes - because every codebase needs more groaning.
"""

import pytest


class TestDadJokes:
    """Tests that are so bad, they're good."""

    def test_why_do_programmers_prefer_dark_mode(self):
        """Because light attracts bugs!"""
        dark_mode = True
        bugs_attracted = 0 if dark_mode else 9999
        assert bugs_attracted == 0, "Quick! Turn off the lights!"

    def test_there_are_only_10_types_of_people(self):
        """Those who understand binary and those who don't."""
        people_who_get_it = 0b10
        assert people_who_get_it == 2, "If you don't get this joke, you're in the second group"

    def test_why_did_the_developer_go_broke(self):
        """Because he used up all his cache!"""
        cache = {"money": 1000000}
        cache.clear()  # Oops
        assert len(cache) == 0, "Should have used persistent storage, James!"

    def test_a_sql_query_walks_into_a_bar(self):
        """Walks up to two tables and asks... 'Can I JOIN you?'"""
        table1 = {"id": 1, "name": "Lonely Table"}
        table2 = {"id": 1, "drinks": "Coffee"}

        # Performing the legendary JOIN
        joined = {**table1, **table2}
        assert "name" in joined and "drinks" in joined, "JOIN failed, tables remain forever alone"

    def test_why_do_java_developers_wear_glasses(self):
        """Because they can't C#!"""
        can_see_sharp = False
        assert not can_see_sharp, "Java developers: *squints at .NET*"

    def test_knock_knock_race_condition(self):
        """
        Knock knock.
        Race condition.
        Who's there?
        """
        responses = []
        responses.append("Race condition")
        responses.append("Knock knock")
        responses.append("Who's there?")

        # This is fine. Everything is fine.
        assert len(responses) == 3, "At least they all showed up... eventually"


class TestProgrammerLife:
    """Real struggles, real tests."""

    def test_it_works_on_my_machine(self):
        """The classic excuse."""
        works_locally = True
        works_in_production = True  # We're being optimistic here

        assert works_locally == works_in_production, "Time to containerize everything!"

    def test_copying_from_stack_overflow(self):
        """A proud tradition since 2008."""
        code_quality = "questionable"
        does_it_work = True

        assert does_it_work, f"Code quality: {code_quality}, but hey, it works!"

    def test_off_by_one_errors(self):
        """The two hardest problems in computer science:
        1. Cache invalidation
        2. Naming things
        3. Off-by-one errors
        """
        hardest_problems = ["cache invalidation", "naming things", "off-by-one errors"]
        assert len(hardest_problems) == 3, "Wait, I said TWO problems..."

    def test_regex_solution(self):
        """
        Some people, when confronted with a problem, think
        'I know, I'll use regular expressions.'
        Now they have two problems.
        """
        import re
        problem_count = 1
        re.compile(r".*")  # Using regex
        problem_count += 1

        assert problem_count == 2, "Regex: turning one problem into two since 1951"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
