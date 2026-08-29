DATA_URL := https://data.openstreetmap.us/layercake
LAYERS := addresses boundaries buildings highways parks pois settlements waterways
SCHEMAS := $(LAYERS:%=_data/schema/%.json)

.PHONY: all app site serve update-schema clean

all: site

site: app $(SCHEMAS) _data/sizes.json
	bundle exec jekyll build

app:
	npm run build
	mkdir -p _site/explore/
	cp -R dist/. _site/explore/

serve: app $(SCHEMAS) _data/sizes.json
	bundle exec jekyll serve

_data/schema/%.json:
	@mkdir -p $(@D)
	curl -sfS --retry 3 -o $@ $(DATA_URL)/$*.description.json

_data/sizes.json:
	@mkdir -p $(@D)
	@for layer in $(LAYERS); do \
	  curl -sfS --retry 3 -I $(DATA_URL)/$$layer.parquet \
	    | awk -v layer=$$layer 'tolower($$1) == "content-length:" { print layer, $$2 + 0 }'; \
	done | jq -Rn '[inputs | split(" ")] | map({(.[0]): (.[1] | tonumber)}) | add' > $@

update-schema:
	rm -f $(SCHEMAS) _data/sizes.json
	$(MAKE) $(SCHEMAS) _data/sizes.json

clean:
	rm -rf _site dist .jekyll-cache _data/schema _data/sizes.json
