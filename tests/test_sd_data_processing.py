import pytest
import polar as pl
from pathlib import Path
import os
import sys

# Add the quarter_1 data processing dir to path to import it
sys.path.append(str(Path(__file__).resolve().parent.parent / "data_processing" / "quarter_1"))

from combine_dataset import ensure_temp_dir, cleanup_temp_dir, TEMP_DIR

def test_ensure_temp_dir():
    """Verify that ensure_temp_dir correctly provisions the temporary processing directory."""
    # Ensure it's clean first
    cleanup_temp_dir()
    assert not TEMP_DIR.exists(), "Temp dir should not exist before ensuring"
    
    # Run creation
    ensure_temp_dir()
    assert TEMP_DIR.exists(), "Temp dir should be created"
    assert TEMP_DIR.is_dir(), "Temp path should be a directory"

def test_cleanup_temp_dir():
    """Verify that cleanup_temp_dir removes the temporary processing directory."""
    ensure_temp_dir()
    assert TEMP_DIR.exists(), "Temp dir should exist before cleaning"
    
    # Run cleanup
    cleanup_temp_dir()
    assert not TEMP_DIR.exists(), "Temp dir should be successfully removed"

def test_delete_files(tmp_path):
    """Verify delete_files correctly removes files when provided a list."""
    from combine_dataset import delete_files
    
    # Create dummy files
    f1 = tmp_path / "dummy1.txt"
    f2 = tmp_path / "dummy2.txt"
    f1.touch()
    f2.touch()
    
    assert f1.exists() and f2.exists()
    
    # Delete them
    delete_files([f1, f2])
    
    assert not f1.exists()
    assert not f2.exists()
