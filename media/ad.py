#!/usr/bin/env python3
"""The Twitter advert: a ~33 second motion graphic, 1080x1080, silent.

    manim -qh --format=mp4 media/ad.py Advert

Silent on purpose. Twitter autoplays muted in the timeline, so anything that
depends on sound is lost on the people who have not decided to watch yet; the
whole thing has to read with the volume off.

EVERY PAPER AND EVERY NUMBER IS REAL, taken from the Retraction Watch database
copy in this repository (retraction_watch.csv, data through December 2025). An
advert for a retraction checker cannot invent a retraction, and it does not
have to: 'Wearable Sensor and Its Application in Urban Landscape Design' was
published in Journal of Sensors in 2022 and retracted in 2023 as paper-mill
output.

COLOR is the extension's own, from extension/src/content/ui/styles.css: the
banner red #B42318, the flagged-entry tint rgba(254,226,226,.5), and the badge
pairs (#FEE2E2/#B91C1C, #DCFCE7/#15803D, #DBEAFE/#1D4ED8). The advert and the
thing it advertises should look like the same object.

TYPE. Three families, three jobs. This is a page in a browser, not a
blackboard.

  Charter         the references. A screen book serif, because the thing being
                  shown is a bibliography entry.
  Menlo           DOIs and dates. An identifier should look like an identifier.
  Helvetica Neue  the interface around them: badges, labels, the brand mark.

Pango falls back SILENTLY on a font it cannot resolve, so every family named
here was checked against `fc-list` and then checked again by looking at a
rendered frame, which is the only way to catch a substitution.
"""
from manim import *

BG = "#F5F6F8"          # the page behind a paper
INK = "#111827"
INK_3 = "#4B5563"
INK_4 = "#9CA3AF"
BORDER = "#E5E7EB"

RED = "#B42318"         # the banner
RED_FG = "#B91C1C"      # badge text
RED_BG = "#FEE2E2"      # badge fill
GREEN_FG = "#15803D"
GREEN_BG = "#DCFCE7"
BLUE_FG = "#1D4ED8"
BLUE_BG = "#DBEAFE"

REF_F = "Charter"
NUM_F = "Menlo"
UI_F = "Helvetica Neue"

config.pixel_width = 1080
config.pixel_height = 1080
# The frame is measured in units, and setting the pixel dimensions does NOT
# resize it: it stays 14.22 units wide from the 16:9 default while rendering
# into a square, which squeezes every letter horizontally.
config.frame_width = 8.0
config.frame_height = 8.0
config.frame_rate = 30
config.background_color = BG

LEFT_X = -3.2           # one margin, held by everything on screen
COL = 6.4               # and one column width

# Title, journal, published year, retracted date, why. All from
# retraction_watch.csv; the reason is the Retraction Watch label, shortened to
# the one that carries the story.
CASES = [
    ("Hydroxychloroquine or chloroquine with or without a macrolide "
     "for treatment of COVID-19",
     "Lancet", "2020", "Retracted 5 June 2020", "Unreliable data"),
    ("Niosomes: a novel targeted drug delivery system for cancer",
     "Medical Oncology", "2022", "Retracted 22 March 2025", "Paper mill"),
    ("Wearable Sensor and Its Application in Urban Landscape Design",
     "Journal of Sensors", "2022", "Retracted 4 October 2023", "Paper mill"),
]

# Retractions by year of the retraction notice, Retraction Watch, Dec 2025.
# 2023 is the year Hindawi withdrew whole journals at once.
YEARS = [
    (2013, 1447), (2014, 1110), (2015, 1542), (2016, 1684), (2017, 1704),
    (2018, 2527), (2019, 2902), (2020, 3073), (2021, 3899), (2022, 5555),
    (2023, 13122), (2024, 5878),
]


def ref(text, size=34, color=INK, weight=NORMAL):
    return Text(text, font=REF_F, font_size=size, color=color, weight=weight)


def mono(text, size=22, color=INK_4):
    return Text(text, font=NUM_F, font_size=size, color=color)


def ui(text, size=22, color=INK_3, weight=NORMAL):
    return Text(text, font=UI_F, font_size=size, color=color, weight=weight)


def para(text, size=34, color=INK, width=COL, weight=NORMAL, buff=0.16):
    """Greedy word wrap. Manim will not wrap for you, and a square frame is
    unforgiving of a line that runs three characters over."""
    words, lines, line = text.split(), [], ""
    for w in words:
        trial = f"{line} {w}".strip()
        if ref(trial, size, color, weight).width > width and line:
            lines.append(line)
            line = w
        else:
            line = trial
    lines.append(line)
    group = VGroup(*[ref(l, size, color, weight) for l in lines])
    return group.arrange(DOWN, buff=buff, aligned_edge=LEFT)


def fit(mob, width=COL):
    """A square frame is unforgiving: anything wider than the column is
    scaled to it rather than allowed off the edge."""
    if mob.width > width:
        mob.scale(width / mob.width)
    return mob


def place(mob, top_y, x=LEFT_X):
    """Pin a block by its top-left corner. Blocks here grow downward, so the
    top is the edge that has to stay clear of the brand mark."""
    mob.move_to([x, 0, 0], aligned_edge=LEFT)
    mob.shift(UP * (top_y - mob.get_top()[1]))
    return mob


def badge(label, fg=RED_FG, bg=RED_BG, size=24):
    """The extension's own status pill."""
    text = Text(label, font=UI_F, font_size=size, color=fg, weight=BOLD)
    pill = SurroundingRectangle(text, buff=0.16, corner_radius=0.11,
                                stroke_width=2, stroke_color=fg,
                                fill_color=bg, fill_opacity=1.0)
    return VGroup(pill, text)


class Advert(Scene):
    def construct(self):
        self.add(self.chrome())
        self.hook()
        self.parade()
        self.chart()
        self.turn()
        self.demo()
        self.card()

    # The brand sits on screen the whole time, small, in the corner. Most of
    # this video will be watched for two seconds by someone who never reaches
    # the end card.
    def chrome(self):
        mark = ui("CITICIOUS", 20, INK_4, weight=BOLD)
        mark.to_corner(UL, buff=0.62)
        rule = Line(LEFT * 0.42, RIGHT * 0.42, stroke_width=3, color=RED)
        rule.next_to(mark, DOWN, buff=0.2, aligned_edge=LEFT)
        return VGroup(mark, rule)

    def flag(self, block):
        """Tint the entry and rule its left edge, the way the content script
        marks a flagged reference in a real bibliography."""
        tint = Rectangle(width=COL + 0.5, height=block.height + 0.5,
                         stroke_width=0, fill_color=RED_BG, fill_opacity=0.5)
        tint.move_to(block).shift(RIGHT * 0.09)
        edge = Line(tint.get_corner(UL), tint.get_corner(DL),
                    stroke_width=6, color=RED)
        # Behind the entry: added on top it washed out every word it covered.
        return VGroup(tint, edge).set_z_index(-1)

    # ---- 0:00  One reference, held long enough to look ordinary.
    def hook(self):
        entry = VGroup(
            para("Wakefield AJ, et al. Ileal-lymphoid-nodular hyperplasia, "
                 "non-specific colitis, and pervasive developmental disorder "
                 "in children.", 30),
            ref("Lancet. 1998;351:637–41.", 30, INK_3),
            mono("10.1016/S0140-6736(97)11096-0", 21),
        ).arrange(DOWN, buff=0.26, aligned_edge=LEFT)
        place(entry, 2.15)

        self.play(FadeIn(entry, shift=RIGHT * 0.25), run_time=0.55)
        self.wait(1.25)                     # long enough to read it as normal

        mark = self.flag(entry)
        pill = badge("RETRACTED")
        pill.next_to(entry, DOWN, buff=0.62, aligned_edge=LEFT)
        note = ui("Retracted 6 February 2010 · Falsification of data", 21, INK_3)
        note.next_to(pill, DOWN, buff=0.42, aligned_edge=LEFT)

        # The verdict lands rather than arrives: a small overshoot, no drift.
        self.play(FadeIn(mark), run_time=0.28)
        self.play(FadeIn(pill, scale=1.25), run_time=0.38)
        self.play(FadeIn(note), run_time=0.3)
        self.wait(1.5)
        self.play(FadeOut(VGroup(entry, mark, pill, note), shift=LEFT * 0.3),
                  run_time=0.42)

    # ---- 0:07  Three more, quickly. The rhythm is the argument.
    def parade(self):
        for title, journal, year, when, why in CASES:
            entry = VGroup(
                para(f"{title}.", 34),
                ref(f"{journal}, {year}", 32, INK_3),
            ).arrange(DOWN, buff=0.3, aligned_edge=LEFT)
            place(entry, 1.95)
            mark = self.flag(entry)

            pill = badge("RETRACTED")
            pill.next_to(entry, DOWN, buff=0.6, aligned_edge=LEFT)
            note = ui(f"{when} · {why}", 21, INK_3)
            note.next_to(pill, DOWN, buff=0.4, aligned_edge=LEFT)

            self.play(FadeIn(entry, shift=RIGHT * 0.2), run_time=0.4)
            self.play(FadeIn(mark), FadeIn(pill, scale=1.18), run_time=0.32)
            self.play(FadeIn(note), run_time=0.22)
            self.wait(1.05)
            self.play(FadeOut(VGroup(entry, mark, pill, note), shift=LEFT * 0.25),
                      run_time=0.28)

    # ---- 0:14  The size of the thing, which is the actual finding.
    def chart(self):
        top = max(n for _, n in YEARS)
        width, gap = 0.42, 0.11
        floor_y, max_h = -1.2, 2.85

        title = ui("RETRACTIONS PER YEAR", 22, INK_3, weight=BOLD)
        title.move_to([LEFT_X, 2.55, 0], aligned_edge=LEFT)

        bars, ticks = VGroup(), VGroup()
        for i, (year, n) in enumerate(YEARS):
            h = max_h * (n / top)
            hot = year == 2023
            bar = Rectangle(width=width, height=h, stroke_width=0,
                            fill_color=RED if hot else INK_4,
                            fill_opacity=1.0 if hot else 0.45)
            bar.move_to([LEFT_X + width / 2 + i * (width + gap),
                         floor_y + h / 2, 0])
            bars.add(bar)
            if year in (2013, 2023):
                t = mono(str(year), 20, RED if hot else INK_4)
                t.next_to([bar.get_x(), floor_y, 0], DOWN, buff=0.22)
                ticks.add(t)

        axis = Line([LEFT_X - 0.1, floor_y, 0],
                    [LEFT_X + len(YEARS) * (width + gap), floor_y, 0],
                    stroke_width=2, color=BORDER)

        self.play(FadeIn(title), FadeIn(axis), run_time=0.4)
        self.play(LaggedStart(*[GrowFromEdge(b, DOWN) for b in bars],
                              lag_ratio=0.07), run_time=1.5)
        self.play(FadeIn(ticks), run_time=0.25)

        # The count arrives after the bar it belongs to, so it reads as a
        # verdict on the chart rather than as part of its furniture.
        spike = bars[-2]
        count = ui("13,122", 30, RED, weight=BOLD)
        count.next_to(spike, UP, buff=0.22)
        self.play(FadeIn(count, shift=DOWN * 0.15), run_time=0.4)
        self.wait(0.5)

        punch = VGroup(
            fit(ref("62,995 retractions on record.", 36, INK, weight=BOLD)),
            fit(ref("The papers stay where they were.", 36, RED)),
        ).arrange(DOWN, buff=0.2, aligned_edge=LEFT)
        place(punch, -1.95)
        src = ui("Retraction Watch database, December 2025", 19, INK_4)
        src.next_to(punch, DOWN, buff=0.32, aligned_edge=LEFT)

        self.play(FadeIn(punch, shift=UP * 0.18), run_time=0.5)
        self.play(FadeIn(src), run_time=0.3)
        self.wait(1.5)
        self.play(FadeOut(VGroup(bars, ticks, axis, title, count, punch, src)),
                  run_time=0.42)

    # ---- 0:21  The question the extension answers.
    def turn(self):
        line1 = fit(ref("A paper cites forty references.", 40))
        line2 = fit(ref("Which one was retracted?", 40, RED, weight=BOLD))
        line1.move_to([LEFT_X, 0.8, 0], aligned_edge=LEFT)
        line2.next_to(line1, DOWN, buff=0.3, aligned_edge=LEFT)
        note = ui("By hand, that is forty lookups, one at a time.", 21, INK_3)
        note.next_to(line2, DOWN, buff=0.65, aligned_edge=LEFT)

        self.play(FadeIn(line1, shift=RIGHT * 0.2), run_time=0.42)
        self.play(FadeIn(line2, shift=RIGHT * 0.2), run_time=0.42)
        self.play(FadeIn(note), run_time=0.32)
        self.wait(1.35)
        self.play(FadeOut(VGroup(line1, line2, note), shift=LEFT * 0.25),
                  run_time=0.4)

    # ---- 0:25  What it actually does, in the shape it does it in.
    def demo(self):
        title = ui("EVERY REFERENCE, CHECKED IN PLACE", 22, INK_3, weight=BOLD)
        title.move_to([LEFT_X, 2.35, 0], aligned_edge=LEFT)

        # Gray rules, not invented citations: the point is the verdict column,
        # and a made-up reference in an advert about fabricated references
        # would be a poor joke to have to explain. UNVERIFIED is in the list on
        # purpose; a registered DOI that simply is not indexed is never called
        # fake, and the column has to show that it is not.
        verdicts = [
            ("VERIFIED", GREEN_FG, GREEN_BG),
            ("DOI NOT FOUND", RED_FG, RED_BG),
            ("VERIFIED", GREEN_FG, GREEN_BG),
            ("UNVERIFIED", BLUE_FG, BLUE_BG),
            ("RETRACTED", RED_FG, RED_BG),
        ]
        rows, pills = VGroup(), VGroup()
        for i, (label, fg, bg) in enumerate(verdicts):
            n = mono(f"{i + 1}.", 21, INK_4)
            long = RoundedRectangle(corner_radius=0.05, width=2.3, height=0.13,
                                    stroke_width=0, fill_color=INK_4,
                                    fill_opacity=0.5)
            short = RoundedRectangle(corner_radius=0.05, width=1.4, height=0.13,
                                     stroke_width=0, fill_color=INK_4,
                                     fill_opacity=0.28)
            lines = VGroup(long, short).arrange(DOWN, buff=0.17,
                                                aligned_edge=LEFT)
            rows.add(VGroup(n, lines).arrange(RIGHT, buff=0.24, aligned_edge=UP))
            pills.add(badge(label, fg, bg, size=19))

        rows.arrange(DOWN, buff=0.44, aligned_edge=LEFT)
        place(rows, 1.6)
        for row, pill in zip(rows, pills):
            pill.move_to([3.2 - pill.width / 2, row.get_y(), 0])

        self.play(FadeIn(title), run_time=0.3)
        self.play(LaggedStart(*[FadeIn(r, shift=RIGHT * 0.15) for r in rows],
                              lag_ratio=0.14), run_time=0.9)
        # The badges arrive down the column at the pace the checks resolve.
        self.play(LaggedStart(*[FadeIn(p, scale=1.2) for p in pills],
                              lag_ratio=0.3), run_time=1.5)
        self.wait(0.6)

        caption = fit(ref("Checked while you read the page.", 32, INK))
        place(caption, -2.85)
        self.play(FadeIn(caption, shift=UP * 0.15), run_time=0.42)
        self.wait(1.3)
        self.play(FadeOut(VGroup(title, rows, pills, caption)), run_time=0.42)

    # ---- 0:31  Where to go.
    def card(self):
        logo = ImageMobject("citicious_logo.png").scale_to_fit_height(1.05)
        logo.move_to([LEFT_X + logo.width / 2, 2.1, 0])

        name = ref("Citicious", 64, INK, weight=BOLD)
        rule = Line(LEFT * 0.42, RIGHT * 0.42, stroke_width=4, color=RED)
        tag = para("Retracted articles and fabricated citations, "
                   "flagged as you read.", 30, INK_3)
        src = ui("Crossref · OpenAlex · Retraction Watch · doi.org", 19, INK_4)
        line = ui("A free Chrome extension", 24, INK_3, weight=BOLD)
        url = ui("bit.ly/citicious", 30, RED, weight=BOLD)

        name.next_to(logo, DOWN, buff=0.42).align_to(logo, LEFT)
        rule.next_to(name, DOWN, buff=0.34, aligned_edge=LEFT)
        tag.next_to(rule, DOWN, buff=0.34, aligned_edge=LEFT)
        src.next_to(tag, DOWN, buff=0.42, aligned_edge=LEFT)
        line.next_to(src, DOWN, buff=0.42, aligned_edge=LEFT)
        url.next_to(line, DOWN, buff=0.2, aligned_edge=LEFT)
        for m in (name, rule, tag, src, line, url):
            fit(m).align_to(logo, LEFT)

        self.play(FadeIn(logo, shift=RIGHT * 0.2), run_time=0.5)
        self.play(FadeIn(name, shift=RIGHT * 0.2), GrowFromEdge(rule, LEFT),
                  run_time=0.5)
        self.play(FadeIn(tag), run_time=0.4)
        self.play(FadeIn(src), run_time=0.3)
        self.play(FadeIn(line), FadeIn(url, shift=UP * 0.1), run_time=0.4)
        self.wait(2.4)
