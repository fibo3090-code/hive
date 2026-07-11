use std::{
    path::{Path, PathBuf},
    process::Command,
};

use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum GitError {
    #[error("workspace not found: {0}")]
    MissingWorkspace(String),
    #[error("git executable failed: {0}")]
    Git(String),
    #[error("invalid git argument: {0}")]
    InvalidArg(String),
    #[error("parse error: {0}")]
    Parse(String),
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusEntry {
    pub path: String,
    pub index_status: String,
    pub worktree_status: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
    pub name: String,
    pub current: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub authored_at: String,
    pub summary: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitTreeEntry {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub size: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFile {
    pub path: String,
    pub reference: String,
    pub content: String,
    pub binary: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiff {
    pub reference: String,
    pub patch: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubStatus {
    pub connected: bool,
    pub owner: Option<String>,
    pub repo: Option<String>,
    pub default_branch: Option<String>,
    pub masked_token: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPullRequest {
    pub number: i64,
    pub title: String,
    pub state: String,
    pub html_url: String,
    pub author: String,
    pub head: String,
    pub base: String,
}

#[derive(Clone, Debug)]
pub struct CreatePullRequest {
    pub title: String,
    pub body: Option<String>,
    pub head: String,
    pub base: String,
}

pub struct GitRepo {
    root: PathBuf,
}

/// C251: branch names and references arrive from HTTP handlers and LLM tool
/// calls, and `run_git` places them in positional argument slots. `git`
/// happily treats a positional that starts with `-` as an *option* —
/// `checkout("--git-dir=/tmp/evil")` or `tree(Some("--output=/tmp/x"))` would
/// redirect the operation entirely. Shell injection was never possible
/// (`Command` doesn't invoke a shell); this closes the option-injection
/// channel by rejecting anything that can't be a plain ref: leading `-`,
/// embedded NUL/newline, or empty input.
fn ensure_safe_ref(value: &str, what: &str) -> Result<(), GitError> {
    if value.is_empty() {
        return Err(GitError::InvalidArg(format!("{what} must not be empty")));
    }
    if value.starts_with('-') {
        return Err(GitError::InvalidArg(format!(
            "{what} must not start with '-': {value:?}"
        )));
    }
    if value.contains(['\0', '\n']) {
        return Err(GitError::InvalidArg(format!(
            "{what} contains a control character: {value:?}"
        )));
    }
    Ok(())
}

impl GitRepo {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn ensure_root(&self) -> Result<(), GitError> {
        if self.root.exists() {
            Ok(())
        } else {
            Err(GitError::MissingWorkspace(self.root.display().to_string()))
        }
    }

    fn run_git(&self, args: &[&str]) -> Result<String, GitError> {
        self.ensure_root()?;
        let output = Command::new("git")
            .args(args)
            .current_dir(&self.root)
            .output()?;
        if !output.status.success() {
            return Err(GitError::Git(
                String::from_utf8_lossy(&output.stderr).trim().to_owned(),
            ));
        }
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }

    fn run_git_env(&self, args: &[&str], envs: &[(&str, &str)]) -> Result<String, GitError> {
        self.ensure_root()?;
        let mut command = Command::new("git");
        command.args(args).current_dir(&self.root);
        for (k, v) in envs {
            command.env(k, v);
        }
        let output = command.output()?;
        if !output.status.success() {
            return Err(GitError::Git(
                String::from_utf8_lossy(&output.stderr).trim().to_owned(),
            ));
        }
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }

    pub fn init(&self) -> Result<(), GitError> {
        std::fs::create_dir_all(&self.root)?;
        let dot_git = self.root.join(".git");
        if dot_git.exists() {
            return Ok(());
        }
        let _ = self.run_git(&["init"])?;
        let _ = self.run_git(&["branch", "-m", "main"]);
        Ok(())
    }

    pub fn branches(&self) -> Result<Vec<GitBranch>, GitError> {
        let output = self.run_git(&["branch", "--list", "--format=%(refname:short)|%(HEAD)"])?;
        Ok(output
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(|line| {
                let mut parts = line.splitn(2, '|');
                let name = parts.next().unwrap_or_default().trim().to_owned();
                let head = parts.next().unwrap_or_default().trim();
                GitBranch {
                    name,
                    current: head == "*",
                }
            })
            .collect())
    }

    pub fn status(&self) -> Result<Vec<GitStatusEntry>, GitError> {
        let output = self.run_git(&["status", "--porcelain=v1"])?;
        Ok(output
            .lines()
            .filter_map(|line| {
                if line.len() < 4 {
                    return None;
                }
                let index_status = line[0..1].to_owned();
                let worktree_status = line[1..2].to_owned();
                let path = line[3..].trim().replace('\\', "/");
                Some(GitStatusEntry {
                    path,
                    index_status,
                    worktree_status,
                })
            })
            .collect())
    }

    pub fn create_branch(&self, name: &str) -> Result<(), GitError> {
        ensure_safe_ref(name, "branch name")?;
        let _ = self.run_git(&["branch", name])?;
        Ok(())
    }

    pub fn checkout(&self, name: &str, create: bool) -> Result<(), GitError> {
        ensure_safe_ref(name, "branch name")?;
        if create {
            let _ = self.run_git(&["checkout", "-b", name])?;
        } else {
            let _ = self.run_git(&["checkout", name])?;
        }
        Ok(())
    }

    pub fn log(&self, limit: usize) -> Result<Vec<GitCommit>, GitError> {
        let output = self.run_git(&[
            "log",
            "--date=iso-strict",
            &format!("-n{limit}"),
            "--pretty=format:%H%x1f%an%x1f%ad%x1f%s",
        ])?;
        Ok(output
            .lines()
            .filter_map(|line| {
                let mut parts = line.split('\u{1f}');
                let hash = parts.next()?.to_owned();
                let author = parts.next()?.to_owned();
                let authored_at = parts.next()?.to_owned();
                let summary = parts.next().unwrap_or_default().to_owned();
                Some(GitCommit {
                    short_hash: hash.chars().take(7).collect(),
                    hash,
                    author,
                    authored_at,
                    summary,
                })
            })
            .collect())
    }

    pub fn tree(&self, reference: Option<&str>) -> Result<Vec<GitTreeEntry>, GitError> {
        let reference = reference.unwrap_or("HEAD");
        ensure_safe_ref(reference, "reference")?;
        let output = self.run_git(&["ls-tree", "-r", "-t", "-l", reference])?;
        let mut entries = Vec::new();
        for line in output.lines() {
            if line.trim().is_empty() {
                continue;
            }
            let Some((left, path)) = line.split_once('\t') else {
                continue;
            };
            let mut left_parts = left.split_whitespace();
            let _mode = left_parts.next();
            let kind = left_parts.next().unwrap_or("blob").to_owned();
            let _hash = left_parts.next();
            let size = left_parts.next().and_then(|raw| raw.parse::<u64>().ok());
            let normalized = path.replace('\\', "/");
            let name = normalized
                .rsplit('/')
                .next()
                .unwrap_or(normalized.as_str())
                .to_owned();
            entries.push(GitTreeEntry {
                path: normalized,
                name,
                kind,
                size,
            });
        }
        Ok(entries)
    }

    pub fn file(&self, reference: Option<&str>, path: &str) -> Result<GitFile, GitError> {
        let reference = reference.unwrap_or("HEAD");
        ensure_safe_ref(reference, "reference")?;
        let spec = format!("{reference}:{path}");
        let output = self.run_git(&["show", &spec])?;
        Ok(GitFile {
            path: path.to_owned(),
            reference: reference.to_owned(),
            content: output,
            binary: false,
        })
    }

    pub fn diff(&self, reference: Option<&str>) -> Result<GitDiff, GitError> {
        let reference = reference.unwrap_or("WORKTREE");
        ensure_safe_ref(reference, "reference")?;
        let args = if reference.eq_ignore_ascii_case("WORKTREE") {
            vec!["diff", "HEAD"]
        } else {
            vec!["show", "--format=", "--patch", reference]
        };
        let output = self.run_git(&args)?;
        Ok(GitDiff {
            reference: reference.to_owned(),
            patch: output,
        })
    }

    pub fn commit(
        &self,
        message: &str,
        author_name: &str,
        author_email: &str,
        paths: Option<&[String]>,
    ) -> Result<GitCommit, GitError> {
        if let Some(paths) = paths {
            if paths.is_empty() {
                let _ = self.run_git(&["add", "-A"])?;
            } else {
                let mut args = vec!["add", "--"];
                let owned = paths.iter().map(String::as_str).collect::<Vec<_>>();
                args.extend(owned.iter().copied());
                let _ = self.run_git(&args)?;
            }
        } else {
            let _ = self.run_git(&["add", "-A"])?;
        }
        let _ = self.run_git_env(
            &["commit", "-m", message],
            &[
                ("GIT_AUTHOR_NAME", author_name),
                ("GIT_AUTHOR_EMAIL", author_email),
                ("GIT_COMMITTER_NAME", author_name),
                ("GIT_COMMITTER_EMAIL", author_email),
            ],
        )?;
        self.log(1)?
            .into_iter()
            .next()
            .ok_or_else(|| GitError::Parse("missing commit after commit".into()))
    }

    pub fn restore(&self, paths: &[String]) -> Result<(), GitError> {
        if paths.is_empty() {
            let _ = self.run_git(&["restore", "--source=HEAD", "--staged", "--worktree", "."])?;
            return Ok(());
        }
        let mut args = vec!["restore", "--source=HEAD", "--staged", "--worktree", "--"];
        let owned = paths.iter().map(String::as_str).collect::<Vec<_>>();
        args.extend(owned.iter().copied());
        let _ = self.run_git(&args)?;
        Ok(())
    }

    /// `git pull` (fast-forward against the configured upstream). Returns the
    /// command's stdout (and stderr, which git uses for progress).
    pub fn pull(&self) -> Result<String, GitError> {
        self.run_git(&["pull", "--ff-only"])
    }

    /// `git push` to the configured upstream for the current branch.
    pub fn push(&self) -> Result<String, GitError> {
        self.run_git(&["push"])
    }
}

pub struct GitHubClient {
    http: reqwest::Client,
    owner: String,
    repo: String,
    token: String,
}

impl GitHubClient {
    pub fn new(
        owner: impl Into<String>,
        repo: impl Into<String>,
        token: impl Into<String>,
    ) -> Self {
        Self {
            http: reqwest::Client::new(),
            owner: owner.into(),
            repo: repo.into(),
            token: token.into(),
        }
    }

    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        self.http
            .request(
                method,
                format!(
                    "https://api.github.com/repos/{}/{}/{}",
                    self.owner, self.repo, path
                ),
            )
            .bearer_auth(&self.token)
            .header("User-Agent", "hive-api")
            .header("Accept", "application/vnd.github+json")
    }

    pub async fn status(&self, masked_token: Option<String>) -> Result<GitHubStatus, GitError> {
        let response = self.request(reqwest::Method::GET, "").send().await?;
        if !response.status().is_success() {
            return Ok(GitHubStatus {
                connected: false,
                owner: Some(self.owner.clone()),
                repo: Some(self.repo.clone()),
                default_branch: None,
                masked_token,
            });
        }
        let payload: serde_json::Value = response.json().await?;
        Ok(GitHubStatus {
            connected: true,
            owner: Some(self.owner.clone()),
            repo: Some(self.repo.clone()),
            default_branch: payload
                .get("default_branch")
                .and_then(serde_json::Value::as_str)
                .map(ToOwned::to_owned),
            masked_token,
        })
    }

    pub async fn list_pulls(&self) -> Result<Vec<GitHubPullRequest>, GitError> {
        let response = self
            .request(reqwest::Method::GET, "pulls?state=all&per_page=20")
            .send()
            .await?;
        let payload: Vec<serde_json::Value> = response.error_for_status()?.json().await?;
        Ok(payload
            .into_iter()
            .map(|pr| GitHubPullRequest {
                number: pr
                    .get("number")
                    .and_then(serde_json::Value::as_i64)
                    .unwrap_or_default(),
                title: pr
                    .get("title")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                state: pr
                    .get("state")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                html_url: pr
                    .get("html_url")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                author: pr
                    .get("user")
                    .and_then(|value| value.get("login"))
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                head: pr
                    .get("head")
                    .and_then(|value| value.get("ref"))
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                base: pr
                    .get("base")
                    .and_then(|value| value.get("ref"))
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
            })
            .collect())
    }

    pub async fn create_pull(
        &self,
        request: CreatePullRequest,
    ) -> Result<GitHubPullRequest, GitError> {
        let response = self
            .request(reqwest::Method::POST, "pulls")
            .json(&serde_json::json!({
                "title": request.title,
                "body": request.body,
                "head": request.head,
                "base": request.base,
            }))
            .send()
            .await?;
        let pr: serde_json::Value = response.error_for_status()?.json().await?;
        Ok(GitHubPullRequest {
            number: pr
                .get("number")
                .and_then(serde_json::Value::as_i64)
                .unwrap_or_default(),
            title: pr
                .get("title")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            state: pr
                .get("state")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            html_url: pr
                .get("html_url")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            author: pr
                .get("user")
                .and_then(|value| value.get("login"))
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            head: pr
                .get("head")
                .and_then(|value| value.get("ref"))
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            base: pr
                .get("base")
                .and_then(|value| value.get("ref"))
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
                .to_owned(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_repo() -> GitRepo {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("hive-git-test-{nanos:x}"));
        let repo = GitRepo::new(&dir);
        repo.init().expect("git init");
        repo
    }

    #[test]
    fn ensure_safe_ref_accepts_normal_refs() {
        for ok in ["main", "feature/x", "HEAD", "HEAD~2", "v1.0.0", "abc123"] {
            assert!(ensure_safe_ref(ok, "ref").is_ok(), "{ok} should pass");
        }
    }

    #[test]
    fn ensure_safe_ref_rejects_option_injection() {
        for bad in [
            "--git-dir=/tmp/evil",
            "-b",
            "--output=/tmp/x",
            "",
            "main\nevil",
            "main\0evil",
        ] {
            assert!(
                matches!(ensure_safe_ref(bad, "ref"), Err(GitError::InvalidArg(_))),
                "{bad:?} should be rejected"
            );
        }
    }

    #[test]
    fn create_branch_and_checkout_reject_option_like_names() {
        let repo = fresh_repo();
        assert!(matches!(
            repo.create_branch("--git-dir=/tmp/evil"),
            Err(GitError::InvalidArg(_))
        ));
        assert!(matches!(
            repo.checkout("-b", false),
            Err(GitError::InvalidArg(_))
        ));
        assert!(matches!(
            repo.tree(Some("--output=/tmp/x")),
            Err(GitError::InvalidArg(_))
        ));
        assert!(matches!(
            repo.diff(Some("--no-index")),
            Err(GitError::InvalidArg(_))
        ));
        assert!(matches!(
            repo.file(Some("-Oorderfile"), "README.md"),
            Err(GitError::InvalidArg(_))
        ));
    }

    #[test]
    fn commit_checkout_log_roundtrip_still_works() {
        let repo = fresh_repo();
        std::fs::write(repo.root().join("a.txt"), "hello").unwrap();
        let commit = repo
            .commit("initial", "Test", "test@example.com", None)
            .unwrap();
        assert_eq!(commit.summary, "initial");
        repo.checkout("feature/x", true).unwrap();
        let branches = repo.branches().unwrap();
        assert!(branches.iter().any(|b| b.name == "feature/x" && b.current));
        let log = repo.log(5).unwrap();
        assert_eq!(log.len(), 1);
    }
}
