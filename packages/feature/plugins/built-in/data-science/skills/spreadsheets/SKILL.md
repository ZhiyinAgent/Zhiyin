---
name: spreadsheets
description: >-
  Use when making an Excel workbook for a person to use: a budget, a plan, a model of costs, a table they will change and read again.
---

A workbook a person keeps is a tool, not a printout: when they change one figure, everything that follows from it must follow. Build it so that it does, and so that the numbers you report are the ones it computes.

**Inputs once, everything else a formula.** Put each assumption in its own labelled cell, on an Inputs or Summary sheet: the exchange rate and its date, a rent, a number of months, a rate. Every figure derived from them is a formula that refers to those cells, never a number you computed and typed in. A summary refers to the totals of the other sheets, as `='One-time'!E35`, rather than repeating them. A scenario is a row of formulas over its own inputs, not a copy of the sheet with other numbers.

**Write it with openpyxl** in run_python, from a .py file in the workspace that builds the whole workbook again when run. A formula is written as text starting with `=`. openpyxl writes formulas without their results and marks the workbook to be computed when it is opened, which Excel and LibreOffice do; until then the cells hold no value. So:
- Check the numbers in the same script: compute each total in Python from the same inputs, print it, and use those figures in your answer. Do not read the workbook back for them: openpyxl reads a formula's result as empty.
- After saving, open the workbook again with openpyxl and print every formula cell with its formula, to see that each refers to the cells you meant, sheet names quoted when they hold spaces.
- Say in your answer that the totals are computed when the workbook is opened in Excel or LibreOffice, since a file preview may show those cells empty.

**Make it readable.** One table per sheet, its header in the first row, frozen, columns wide enough for their contents. Money as money, with its currency in the number format or the header; rates as percentages; dates as dates, not text. No merged cells inside a table. Units in headers, never in the cells of numbers. A sheet of sources and assumptions, each with its date, and what could not be verified, marked as such.
