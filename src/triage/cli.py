"""Commands used by the container: `triage pull`, `triage serve`, `triage eval`."""

from __future__ import annotations

import typer

app = typer.Typer(add_completion=False, no_args_is_help=True)


@app.command()
def pull() -> None:
    """Download the configured datasets if needed."""
    from .config import settings
    from .datasets import DATASETS, pull

    for name in settings().policy["datasets"]:
        info = pull(DATASETS[name])
        typer.echo(f"{info['title']}: {info['rows']:,} materials, {len(info['columns'])} fields")


@app.command()
def serve(host: str = "0.0.0.0", port: int = 8000) -> None:
    """Start the web app."""
    import uvicorn

    uvicorn.run("triage.api:app", host=host, port=port)


@app.command("eval")
def eval_cmd(case: list[str] = typer.Option([], help="Run only these case ids."),  # noqa: B008
             repeat: int = typer.Option(2, help="Runs per case; results vary because the model picks the filters."),
             rescore: str = typer.Option("", help="Re-check a saved logs/eval-runs/*.json file without calling the model.")) -> None:
    """Run the requests in evals/cases.yaml through the live agent and check the outcomes."""
    from .evals import main

    raise typer.Exit(main(case, repeat, rescore))
