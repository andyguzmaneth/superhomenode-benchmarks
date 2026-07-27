# implementations/

External PIR implementations live here as **git submodules**, each pinned to a
specific commit for reproducibility. Nothing is checked in yet — see
`docs/schemes/inspire.md` for the planned set and open questions.

Add one with, e.g.:

```bash
git submodule add https://github.com/phantomzone-org/poulpy implementations/poulpy
cd implementations/poulpy && git checkout <commit> && cd -
git add .gitmodules implementations/poulpy
```

Keep this directory limited to submodules so the harness always benchmarks a known,
pinned version of upstream code.
