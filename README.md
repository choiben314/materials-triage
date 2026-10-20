# Materials Triage

Helps scientists decide which candidate materials deserve lab time. Describe what you need in plain language; an agent searches public materials databases and open literature, and returns a ranked shortlist where every value and paper is cited, with missing data and caveats marked.

## Run it

You need Docker (with Compose) and an Anthropic API key. An OpenAlex key is optional but recommended (free at openalex.org/settings/api).

1. Copy `.env.example` to `.env` and fill in your keys:

   ```
   ANTHROPIC_API_KEY=sk-ant-...
   OPENALEX_API_KEY=...
   ```

2. Start it:

   ```bash
   docker compose up -d --build
   ```

3. Open http://localhost:8000.

On first start the container downloads each configured dataset (a few minutes, no keys needed) and builds its field catalogue from the dataset's own descriptions and units.

To run the evals:

```bash
docker compose run --rm triage triage eval
```

Evals can be edited in `evals/cases.yaml`

## Using it

Type a request, for example _"Compare TiO2, BiVO4, WO3 and Fe2O3 as photoanodes"_, and press Enter. **Recent** in the composer reopens earlier results.

Two views of each result, switched in the header: **Summary** and **Audit**.

- **Summary** (for the PI): the tool-call trace, the cited summary, what wasn't done, caveats, the reference materials, the ranked shortlist and the other groups.
- **Audit:** adds the criteria and funnel, every evidence record and a link to the raw audit record. Clicking a citation opens this view at that record.

## Deployment Config

- **Port:** 8000. Put it behind the center's single sign-on; the app has no login of its own.
- **Outbound HTTPS only:** `s3.amazonaws.com` and `aflow.org` (dataset downloads), `api.openalex.org` (literature), `api.anthropic.com` (the model).
- **Storage:** datasets and the daily literature cache live in the Docker volume `data`. Audit logs and saved results are written to `./logs` on the host; back that folder up.
- **Config:** mounted read-only from `./config`; requests can't change it.
- **Stop:** `docker compose down`. **Update:** pull the new code, then `docker compose up -d --build`.

## Datasets

| Name    | Source                                         | Fields                           | Terms                                                                                                       |
| ------- | ---------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `mp`    | Materials Project summary data (AWS Open Data) | 54, described by MP's API schema | MP Terms of Use; cite A. Jain et al., _APL Materials_ 1, 011002 (2013)                                      |
| `aflow` | AFLOW, ICSD catalogue (AFLUX API)              | 110, described by AFLOW's schema | Scientific, academic and non-commercial use; cite S. Curtarolo et al., _Comput. Mater. Sci._ 58, 227 (2012) |

To add a dataset, write an adapter in `src/triage/datasets.py` (where to download it, where its field descriptions come from, which field picks one entry per composition, and which fields describe an entry rather than the material) and add its name to `datasets` in `config/policy.yaml`.

## Updating behavior

Edit `config/`, then run `docker compose restart`.

| File                 | Owner           | Controls                                                                                                                                                                                                               |
| -------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config/user.yaml`   | Scientists / PI | Shortlist size, summary length, default view, example prompts                                                                                                                                                          |
| `config/policy.yaml` | Site admin      | Model, datasets, literature depth, step limit; **field notes** (known biases of a field, with a source link, used to correct filters); **always_exclude** (elements removed from every search, radioactive by default) |

## Audit log

Each request appends a line to `logs/audit.jsonl`: the request, the agent's steps, the criteria, what wasn't done, the shortlist, model metadata, etc. The full result is in `logs/results/<id>.json`, reopenable from **Recent**.

## Code map

```
src/triage/agent.py       tools, the agent loop, the summary validator
src/triage/datasets.py    dataset adapters, download, field catalog, search and ranking
src/triage/literature.py  OpenAlex search, relevance and quote checks, prompt injection scan
src/triage/models.py      result shape
src/triage/api.py         web API with streamed progress; audit.py, config.py, cli.py, evals.py
frontend/src/             one-page React app built from Beautiful UI components (beautifului.dev)
evals/cases.yaml          eval requests and expected outcomes
```
