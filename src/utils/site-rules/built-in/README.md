# Built-in site rules

`rules.json` is the complete, unmodified built-in rules data from
[Read Frog](https://github.com/mengxi-ream/read-frog), distributed under the
GNU General Public License version 3 (see the repository root `LICENSE`).
The source checkout was clean when imported.
The upstream [license](https://github.com/mengxi-ream/read-frog/blob/main/LICENSE)
is preserved alongside this attribution; Readomi adapts and maintains its local
rule library.

- Source file: `src/utils/site-rules/built-in/rules.json`
- Source commit: `678a4d0b72499307acf49faa4e06689cbb1ba578`
- Imported on: 2026-10-03
- Rules: 484, including two global defaults
- SHA-256: `f58ffd26cb0a3094f95028aca66fef97a099e16bf4c0eef9d797533dd99aeac0`

The schema and resolver are also adapted from Read Frog's corresponding
`src/types/config/site-rules.ts` and `src/utils/site-rules/` source files. Readomi
uses a local URL pattern implementation with the same matching semantics,
without adding the upstream browser match-pattern dependency.

The host's inline formula handling, editor JSON validation and X subtitle
source/target adaptation also borrow from that source version. These are
integrated with Readomi's existing translation, subtitle and settings flows.
The DOM filter adopts upstream rule semantics while retaining Readomi's
aria-hidden and main-container handling. Inline atom/token modules and their
formula-family tests are adapted directly, with Readomi classes and cloned SVG
ID prefixes; the placeholder protocol is unchanged.

The public `BUILT_IN_SITE_RULES` export keeps all 484 rules in their original
order while adapting product IDs (`readfrog-*` → `readomi-*`), descriptions
(`Read Frog` → `Readomi`) and DOM selectors/attributes/CSS (`read-frog-*` →
`readomi-*`). The settings list, copied JSON and execution therefore use the
same Readomi rule data. `branding.ts` owns this conversion; it does not edit the
upstream snapshot or remove its original attribution.

Existing configurations with disabled `readfrog-*` IDs remain supported.
`normalizeBuiltInSiteRuleId` and `normalizeDisabledBuiltInRuleIds` map the known
legacy aliases to the corresponding public IDs. Execution and options toggles
use that same normalization, so a previously disabled rule remains disabled
after an upgrade and can be re-enabled normally. Unknown stored IDs are retained.

It validates selectors separately and rejects CSS fragments that load external
resources, use legacy executable declarations, or exceed the existing 8 KB CSS
limit. The imported JSON retains every original field and its original bytes.

`READOMI_SITE_RULES` in `index.ts` holds two compatibility fixes independently
of the imported data: X tweet translations remain separate paragraphs using
the selected translation style, and Engoo keeps Readomi's existing exercise
block handling. Disabling the corresponding upstream rule (`twitter` or
`autoHeight`) also disables its compatibility fix. User rules apply last, so
their selector removals and threshold choices still take precedence.

To update the data, replace `rules.json` with the upstream file, update the
source commit and hash above, and run the site-rules tests. Do not mechanically
rename product classes or rule IDs in the data; `branding.ts` owns that mapping.
