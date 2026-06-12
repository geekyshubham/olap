# Homebrew Packaging

OLAP is easiest to ship through npm first, then wrap with a Homebrew formula that installs the npm package.

## Tap Layout

Create a tap repository:

```bash
brew tap-new geekyshubham/olap
```

Add `Formula/olap.rb`:

```ruby
class Olap < Formula
  desc "Orchestrated loop architect/worker CLI with a Pi-powered TUI"
  homepage "https://github.com/geekyshubham/olap"
  url "https://registry.npmjs.org/@geekyshubham/olap/-/olap-0.1.0.tgz"
  sha256 "<tarball-sha256>"
  license "MIT"

  depends_on "node@22"

  def install
    system Formula["node@22"].opt_bin/"npm", "install", *std_npm_args
    bin.install_symlink libexec/"bin/olap"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/olap --version")
  end
end
```

## Release Flow

1. Run `bash scripts/release.sh patch`.
2. Publish the npm tarball.
3. Download the tarball and compute its checksum:

```bash
npm pack @geekyshubham/olap@0.1.0
shasum -a 256 geekyshubham-olap-0.1.0.tgz
```

4. Update the formula `url`, `sha256`, and version.
5. Run:

```bash
brew install --build-from-source ./Formula/olap.rb
brew test olap
brew audit --strict olap
```

## Notes

- Keep Node pinned to a version compatible with Pi packages. OLAP currently requires Node 22 or newer.
- The formula should install the compiled npm package, not TypeScript source.
- Keep the npm package lean. `npm run pack:check` verifies that `src`, `test`, and `scripts` are excluded.
