"""Replace package presentation in an isolated collection before merging notes.

Note GUIDs, field schemas and card ordinals stay intact so Anki can recognize a
repeat and preserve existing cards and reviews. No imported template or media is
copied to the destination; a plain field-based template is generated instead.
"""
from pathlib import Path
from tempfile import TemporaryDirectory

from anki.collection import Collection, ExportAnkiPackageOptions, ImportAnkiPackageOptions, ImportAnkiPackageRequest


def basic_templates(model):
    fields = [field['name'] for field in model['flds']]
    # The vocabulary package keeps provenance in separate metadata fields.
    # Retain those values in the note, but show pronunciation then meaning.
    if fields[0] == 'Front' and {'Back', 'Pronunciation'} <= set(fields):
        fields = ['Front', 'Pronunciation', 'Back'] + [field for field in fields
            if field not in {'Front', 'Back', 'Pronunciation', 'Day', 'Source', 'Position'}]
    front = '{{' + ('cloze:text:' if model['type'] == 1 else 'text:') + fields[0] + '}}'
    back = '{{FrontSide}}<hr id="answer">' + ''.join(
        '{{#' + field + '}}<div>{{text:' + field + '}}</div>{{/' + field + '}}'
        for field in fields[1:])
    # Cloze answers must reveal the original cloze rather than reuse FrontSide.
    if model['type'] == 1:
        back = front + '<hr id="answer">' + back.split('<hr id="answer">', 1)[1]
    return front, back


def import_content(col, package_path: Path, temp_parent: Path):
    with TemporaryDirectory(prefix='content-import-', dir=temp_parent) as folder:
        normalized = Path(folder) / 'content.apkg'
        staging = Collection(str(Path(folder) / 'collection.anki2'))
        try:
            staging.import_anki_package(ImportAnkiPackageRequest(package_path=str(package_path),
                options=ImportAnkiPackageOptions(with_scheduling=False, with_deck_configs=False)))
            for mid in staging.db.list('select distinct mid from notes'):
                model = staging.models.get(mid)
                front, back = basic_templates(model)
                model['css'] = ''
                for index, template in enumerate(model['tmpls']):
                    # Anki rejects identical fronts on separate card templates.
                    template['qfmt'] = f'<div data-card-index="{index}">{front}</div>' if index else front
                    template['afmt'] = back
                    template['bqfmt'], template['bafmt'] = '', ''
                staging.models.update_dict(model)
            staging.export_anki_package(out_path=str(normalized), options=ExportAnkiPackageOptions(
                with_scheduling=False, with_deck_configs=False, with_media=False, legacy=False), limit=None)
        finally:
            staging.close()
        return col.import_anki_package(ImportAnkiPackageRequest(package_path=str(normalized),
            options=ImportAnkiPackageOptions(merge_notetypes=True, with_scheduling=False, with_deck_configs=False)))
